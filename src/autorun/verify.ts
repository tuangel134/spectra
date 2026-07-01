/**
 * Verification: build/test/lint runners + the no-skeleton gate.
 *
 * After every phase the orchestrator must prove the project is healthy. This
 * module detects the project's verification commands, runs them, and scans the
 * source tree for skeleton/stub markers — because in this mode the project must
 * be delivered complete, never as placeholders.
 */

import { spawn } from "node:child_process"
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, relative, extname } from "node:path"
import { shellFor, detachForGroupKill, killTree, toPosix } from "../util/platform.js"

export interface CommandResult {
  command: string
  ok: boolean
  output: string
  durationMs: number
}

/**
 * Detect verification commands for the project. Honors an explicit list, then
 * falls back to package.json scripts (build/typecheck/lint/test), then to
 * sensible per-ecosystem defaults.
 */
export function detectVerifyCommands(projectRoot: string, explicit: string[] = []): string[] {
  if (explicit.length > 0) return explicit

  const pkgPath = join(projectRoot, "package.json")
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { scripts?: Record<string, string> }
      const scripts = pkg.scripts ?? {}
      const cmds: string[] = []
      // Order matters: compile first (fail fast), then format check, lint, tests.
      for (const name of ["build", "typecheck", "compile", "format:check", "lint", "test"]) {
        if (scripts[name]) cmds.push(`npm run ${name} --silent`)
      }
      // If there's a format/prettier script without a :check variant, add --check.
      if (!scripts["format:check"] && (scripts["format"] || scripts["prettier"])) {
        cmds.splice(1, 0, "npx prettier --check .")
      }
      // Guard against an under-matching test script (a narrow glob that misses a
      // second test directory) by ALSO running the whole node:test tree at once.
      const fullTest = comprehensiveTestCommand(projectRoot)
      if (fullTest && !cmds.includes(fullTest)) cmds.push(fullTest)
      if (cmds.length > 0) return cmds
    } catch {
      // fall through to defaults
    }
  }

  if (existsSync(join(projectRoot, "Cargo.toml"))) return ["cargo fmt -- --check", "cargo build", "cargo test"]
  if (existsSync(join(projectRoot, "go.mod"))) return ["gofmt -l . | grep . && exit 1 || true", "go build ./...", "go test ./..."]
  if (existsSync(join(projectRoot, "pyproject.toml")) || existsSync(join(projectRoot, "setup.py")))
    return ["python -m black --check .", "python -m pytest -q"]

  return []
}

/** Matches test/spec files across the common JS/TS extensions. */
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/

/** Find every test/spec file in the project tree (relative paths). */
export function findTestFiles(projectRoot: string, maxFiles = 4000): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    if (out.length >= maxFiles) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      const full = join(dir, entry)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full)
      else if (TEST_FILE_RE.test(entry)) out.push(toPosix(relative(projectRoot, full)))
      if (out.length >= maxFiles) return
    }
  }
  walk(projectRoot)
  return out
}

/**
 * A command that runs the WHOLE node:test suite at once.
 *
 * The project's own `test` script may under-match (e.g. `node --test test/*.js`
 * that silently misses a second `tests/` directory). Running the full tree
 * together surfaces integration and test-isolation bugs — shared state between
 * suites, ordering dependence — that a narrow glob hides. Returns null when the
 * project isn't using node:test (other runners discover their own files).
 */
export function comprehensiveTestCommand(projectRoot: string): string | null {
  const files = findTestFiles(projectRoot)
  if (files.length === 0) return null
  const usesNodeTest = files.some((rel) => {
    try {
      return /["']node:test["']/.test(readFileSync(join(projectRoot, rel), "utf-8"))
    } catch {
      return false
    }
  })
  return usesNodeTest ? "node --test" : null
}

export interface StructuralIssue {
  kind: "parallel-test-dirs" | "duplicate-module"
  /** Whether this should block delivery (high-confidence) vs. just advise. */
  blocking: boolean
  detail: string
}

const TEST_DIR_NAMES = ["test", "tests", "__tests__", "spec", "specs"]

/**
 * Reduce a filename to the concept it implements, so near-duplicates collide:
 * `accountController.js` and `accounts.js` both normalize to `account`.
 */
function normalizeStem(filename: string): string {
  let s = filename.replace(/\.[cm]?[jt]sx?$/, "").toLowerCase()
  s = s.replace(
    /[._-]?(controller|service|handler|router|routes|route|repository|repo|manager|provider|model|schema|util|utils|helper|helpers)$/,
    "",
  )
  s = s.replace(/s$/, "") // crude singularization (accounts -> account)
  return s
}

/**
 * Detect structural smells that betray an agent re-creating work it forgot it
 * already did — the classic failure mode for smaller models on long runs:
 *
 *  - parallel test directories (e.g. `test/` AND `tests/`), which each pass
 *    alone but conflict over shared state when run together;
 *  - several files in one directory implementing the same concept
 *    (`accounts.js` + `accountController.js`).
 */
export function scanStructuralIssues(projectRoot: string): StructuralIssue[] {
  const issues: StructuralIssue[] = []

  const testDirs = TEST_DIR_NAMES.filter((d) => {
    try {
      return statSync(join(projectRoot, d)).isDirectory()
    } catch {
      return false
    }
  })
  if (testDirs.length > 1) {
    issues.push({
      kind: "parallel-test-dirs",
      blocking: true,
      detail:
        `Multiple test directories exist (${testDirs.join(", ")}). Consolidate ALL tests into a single ` +
        `directory — duplicated suites running over a shared store cause hidden cross-test failures that ` +
        `only appear when the whole suite runs together.`,
    })
  }

  // Group non-test source files per directory by their normalized concept.
  const files = collectSourceFiles(projectRoot)
  const byDir = new Map<string, Map<string, string[]>>()
  for (const rel of Object.keys(files)) {
    const norm = rel.replace(/\\/g, "/")
    const slash = norm.lastIndexOf("/")
    const dir = slash === -1 ? "." : norm.slice(0, slash)
    const base = slash === -1 ? norm : norm.slice(slash + 1)
    if (TEST_FILE_RE.test(base)) continue
    const stem = normalizeStem(base)
    if (stem.length < 3) continue
    if (!byDir.has(dir)) byDir.set(dir, new Map())
    const m = byDir.get(dir)!
    if (!m.has(stem)) m.set(stem, [])
    m.get(stem)!.push(base)
  }
  for (const [dir, m] of byDir) {
    for (const [stem, names] of m) {
      if (names.length > 1) {
        issues.push({
          kind: "duplicate-module",
          blocking: false,
          detail: `${dir}/ has ${names.length} files implementing "${stem}" (${names.join(", ")}). Merge them into one module and update imports.`,
        })
      }
    }
  }

  return issues
}

/** Run a single shell command, capturing combined output. */
export function runCommand(
  command: string,
  cwd: string,
  timeoutMs = 600_000,
): Promise<CommandResult> {
  const start = Date.now()
  return new Promise<CommandResult>((resolvePromise) => {
    const { file, args: shellArgs } = shellFor(command)
    const child = spawn(file, shellArgs, { cwd, env: process.env, ...detachForGroupKill() })
    let output = ""
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      killTree(child)
    }, timeoutMs)

    child.stdout.on("data", (c: Buffer) => (output += c.toString()))
    child.stderr.on("data", (c: Buffer) => (output += c.toString()))
    child.on("error", (err) => {
      clearTimeout(timer)
      resolvePromise({ command, ok: false, output: `spawn failed: ${err.message}`, durationMs: Date.now() - start })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      const note = killed ? `\n[timed out after ${timeoutMs}ms]` : code === 0 ? "" : `\n[exit ${code}]`
      resolvePromise({
        command,
        ok: !killed && code === 0,
        output: (output + note).slice(-12_000),
        durationMs: Date.now() - start,
      })
    })
  })
}

/** Run all verification commands, stopping at the first failure (fail fast). */
export async function runVerification(
  commands: string[],
  cwd: string,
): Promise<{ ok: boolean; results: CommandResult[] }> {
  const results: CommandResult[] = []
  for (const command of commands) {
    const result = await runCommand(command, cwd)
    results.push(result)
    if (!result.ok) return { ok: false, results }
  }
  return { ok: true, results }
}

export interface SkeletonViolation {
  file: string
  line: number
  text: string
}

/** Markers that betray incomplete / placeholder code. */
const SKELETON_PATTERNS: RegExp[] = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bXXX\b/,
  /\bTBD\b/,
  /not[\s_-]?implemented/i,
  /NotImplementedError/,
  /unimplemented!?\s*\(/,
  /throw new Error\(\s*["'`](?:not implemented|todo|unimplemented|stub)/i,
  /placeholder/i,
  /your (?:code|content|implementation|logic) here/i,
  /implement(?:ation)? (?:me|here|this)/i,
  /coming soon/i,
  /lorem ipsum/i,
  /\b(?:replace|fill) (?:this|in|me)\b/i,
  /dummy (?:data|content|value)/i,
  /console\.(?:log|error)\(\s*["'`](?:todo|fixme|implement)/i,
]

/** Lines that are legitimately allowed to contain these words (e.g. this file). */
function isIgnorableFile(file: string): boolean {
  const norm = file.replace(/\\/g, "/")
  const segments = norm.split("/")
  if (segments.some((s) => s === "node_modules" || s === "dist" || s === "build" || s === ".git")) {
    return true
  }
  if (norm.endsWith(".md")) return true
  if (norm.includes("autorun/verify")) return true // self-reference: defines the patterns
  return false
}

/**
 * Scan provided file contents for skeleton markers.
 * @param files map of relative path -> file contents
 */
export function scanForSkeletons(files: Record<string, string>): SkeletonViolation[] {
  const violations: SkeletonViolation[] = []
  for (const [file, content] of Object.entries(files)) {
    if (isIgnorableFile(file)) continue
    const lines = content.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (SKELETON_PATTERNS.some((re) => re.test(line))) {
        violations.push({ file, line: i + 1, text: line.trim().slice(0, 160) })
      }
    }
  }
  return violations
}

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".c", ".cc", ".cpp", ".h", ".hpp",
  ".rb", ".php", ".cs", ".swift", ".kt", ".vue", ".svelte",
])
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".spectra", "target", "vendor", "__pycache__",
])

/** Collect source files (relative path -> contents) for the skeleton gate. */
export function collectSourceFiles(projectRoot: string, maxFiles = 600): Record<string, string> {
  const out: Record<string, string> = {}

  const walk = (dir: string): void => {
    if (Object.keys(out).length >= maxFiles) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      const full = join(dir, entry)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
      } else if (SOURCE_EXT.has(extname(entry)) && st.size < 400_000) {
        try {
          out[toPosix(relative(projectRoot, full))] = readFileSync(full, "utf-8")
        } catch {
          /* ignore unreadable file */
        }
      }
      if (Object.keys(out).length >= maxFiles) return
    }
  }

  walk(projectRoot)
  return out
}


/**
 * A compact snapshot of the delivered project (file tree + samples of key
 * files) for the polish/completeness review. Bounded in size.
 */
export function projectSnapshot(projectRoot: string, maxChars = 12_000): string {
  const files = collectSourceFiles(projectRoot, 400)
  const paths = Object.keys(files).sort()
  let out = `Files (${paths.length}):\n${paths.join("\n")}\n`
  // Sample a few likely-important files, truncated.
  const keyish = paths.filter((p) => /(index|main|app|server|route|router|component|page|model|controller|style|css)/i.test(p))
  const sample = (keyish.length ? keyish : paths).slice(0, 6)
  for (const p of sample) {
    if (out.length > maxChars) break
    out += `\n--- ${p} ---\n${(files[p] ?? "").slice(0, 1400)}\n`
  }
  return out.slice(0, maxChars)
}
