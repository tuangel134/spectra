/**
 * Desktop IDE service.
 *
 * Keeps filesystem, terminal, Git, diagnostics, and spec editing behind the
 * same Runtime permission model used by the agent. The webview never receives
 * an unrestricted filesystem handle or a shell process.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { spawn } from "node:child_process"
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path"
import type { Runtime } from "../runtime.js"
import { evaluatePermission } from "../permission/index.js"
import type { ToolContext, ToolResult } from "../tool/types.js"

const MAX_TREE_ENTRIES = 5_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TERMINAL_COMMAND = 8_000
const MAX_TERMINAL_TIMEOUT = 120_000
const MAX_GIT_OUTPUT = 200_000
const SKIP_NAMES = new Set([
  ".git",
  ".spectra-upgrade-backup",
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  ".cache",
  "coverage",
  "__pycache__",
])

export interface IdeTreeNode {
  name: string
  path: string
  type: "file" | "directory"
  size?: number
  language?: string
  children?: IdeTreeNode[]
}

export interface IdeActionResult {
  ok: boolean
  error?: string
  needsApproval?: boolean
  output?: string
  metadata?: Record<string, unknown>
}

export interface IdeFileResult extends IdeActionResult {
  path?: string
  content?: string
  language?: string
  size?: number
}

export interface GitStatusEntry {
  index: string
  worktree: string
  path: string
}

export interface GitStatusResult extends IdeActionResult {
  branch?: string
  entries?: GitStatusEntry[]
  raw?: string
}

export function languageForPath(path: string): string {
  const extension = extname(path).toLowerCase()
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".jsonc": "json",
    ".md": "markdown",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".sh": "shell",
    ".bash": "shell",
    ".fish": "shell",
    ".ps1": "powershell",
    ".sql": "sql",
    ".toml": "toml",
    ".ini": "ini",
  }
  return map[extension] ?? "plaintext"
}

export function resolveProjectPath(projectRoot: string, requested: string): { abs: string; rel: string } {
  const clean = requested.replace(/\\/g, "/").replace(/^\/+/, "")
  const abs = resolve(projectRoot, clean || ".")
  const rel = relative(projectRoot, abs)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("path outside project")
  }
  return { abs, rel: rel.replace(/\\/g, "/") }
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192))
  if (sample.includes(0)) return true
  let unusual = 0
  for (const byte of sample) {
    if (byte < 7 || (byte > 13 && byte < 32)) unusual++
  }
  return sample.length > 0 && unusual / sample.length > 0.2
}

function sortedEntries(dir: string): string[] {
  return readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
}

export function buildProjectTree(projectRoot: string, maxEntries = MAX_TREE_ENTRIES): IdeTreeNode[] {
  let count = 0
  const walk = (dir: string, parentRel: string): IdeTreeNode[] => {
    const dirs: IdeTreeNode[] = []
    const files: IdeTreeNode[] = []
    let names: string[]
    try {
      names = sortedEntries(dir)
    } catch {
      return []
    }
    for (const name of names) {
      if (count >= maxEntries) break
      if (SKIP_NAMES.has(name)) continue
      if (name.startsWith(".") && ![".gitignore", ".editorconfig", ".env.example"].includes(name)) continue
      const abs = resolve(dir, name)
      let info
      try {
        info = lstatSync(abs)
      } catch {
        continue
      }
      if (info.isSymbolicLink()) continue
      const rel = parentRel ? parentRel + "/" + name : name
      if (info.isDirectory()) {
        count++
        dirs.push({ name, path: rel, type: "directory", children: walk(abs, rel) })
      } else if (info.isFile()) {
        count++
        files.push({ name, path: rel, type: "file", size: info.size, language: languageForPath(rel) })
      }
    }
    return [...dirs, ...files]
  }
  return walk(projectRoot, "")
}

export function parseGitStatus(raw: string): { branch: string; entries: GitStatusEntry[] } {
  const lines = raw.split(/\r?\n/).filter(Boolean)
  let branch = ""
  const entries: GitStatusEntry[] = []
  for (const line of lines) {
    if (line.startsWith("## ")) {
      branch = line.slice(3).split("...")[0]?.trim() ?? ""
      continue
    }
    if (line.length < 4) continue
    const path = line.slice(3).replace(/^"|"$/g, "")
    entries.push({ index: line[0] ?? " ", worktree: line[1] ?? " ", path })
  }
  return { branch, entries }
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<ToolResult> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)
    child.stdout.on("data", (chunk: Buffer) => {
      if (output.length < MAX_GIT_OUTPUT) output += chunk.toString()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      if (output.length < MAX_GIT_OUTPUT) output += chunk.toString()
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      resolveResult({ success: false, output: error.message })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      const suffix = timedOut ? "\n[process timed out]" : code && code !== 0 ? "\n[exit code " + code + "]" : ""
      resolveResult({ success: !timedOut && code === 0, output: (output || "(no output)").slice(0, MAX_GIT_OUTPUT) + suffix })
    })
  })
}

export class IdeService {
  constructor(private readonly rt: Runtime) {}

  private get projectRoot(): string {
    return this.rt.config.projectRoot
  }

  private permissionFor(toolName: string, argValue?: string) {
    const agent = this.rt.agents.current_()
    return evaluatePermission(toolName, { global: this.rt.config.config.permission, agent: agent.permission }, argValue)
  }

  private toolContext(approved: boolean): ToolContext {
    const agent = this.rt.agents.current_()
    return {
      projectRoot: this.projectRoot,
      agentId: agent.id,
      permissionFor: (toolName, argValue) => this.permissionFor(toolName, argValue),
      requestApproval: async () => approved,
      report: (message) => this.rt.pushAudit("ide", message),
      headroom: this.rt.headroom,
    }
  }

  async bootstrap() {
    const git = await this.gitStatus()
    return {
      ok: true,
      project: { root: this.projectRoot, name: basename(this.projectRoot) || "Workspace" },
      tree: buildProjectTree(this.projectRoot),
      git,
      specs: this.rt.specs.list().map((meta: { id: string; title: string; type: string; createdAt: string }) => {
        const tasks = this.rt.specs.loadTasks(meta.id)
        return {
          ...meta,
          tasks: tasks.length,
          completed: tasks.filter((task: { status: string }) => task.status === "completed").length,
        }
      }),
      session: this.rt.sessions.current()
        ? {
            id: this.rt.sessions.current()!.id,
            files: Object.keys(this.rt.sessions.current()!.changedFiles).length,
            logs: this.rt.sessions.current()!.toolLogs.length,
          }
        : null,
    }
  }

  readFile(requested: string): IdeFileResult {
    try {
      const { abs, rel } = resolveProjectPath(this.projectRoot, requested)
      if (!existsSync(abs) || !statSync(abs).isFile()) return { ok: false, error: "file not found" }
      const size = statSync(abs).size
      if (size > MAX_FILE_BYTES) return { ok: false, error: "file exceeds the 2 MiB editor limit" }
      const raw = readFileSync(abs)
      if (isProbablyBinary(raw)) return { ok: false, error: "binary files cannot be opened in the text editor" }
      return { ok: true, path: rel, content: raw.toString("utf-8"), language: languageForPath(rel), size }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }

  saveFile(requested: string, content: string, approved = false): IdeActionResult {
    try {
      const { abs, rel } = resolveProjectPath(this.projectRoot, requested)
      const level = this.permissionFor("edit", rel)
      if (level === "deny") return { ok: false, error: "editing this path is denied by the active security profile" }
      if (level === "ask" && !approved) return { ok: false, needsApproval: true, error: "approval required to save " + rel }
      const before = existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, "utf-8") : null
      mkdirSync(dirname(abs), { recursive: true })
      const temp = abs + ".spectra-ide-" + process.pid + ".tmp"
      try {
        writeFileSync(temp, content, "utf-8")
        renameSync(temp, abs)
      } catch (error) {
        if (existsSync(temp)) {
          try {
            unlinkSync(temp)
          } catch {
            // Best effort cleanup.
          }
        }
        throw error
      }
      const session = this.rt.sessions.current()
      if (session) {
        const change = { path: rel, before, after: content }
        this.rt.sessions.recordFileChange(session.id, change)
        this.rt.sessions.snapshot(session.id, [change])
      }
      this.rt.pushAudit("editor", "Saved " + rel)
      return { ok: true, metadata: { path: rel, bytes: Buffer.byteLength(content) } }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }

  async diagnostics(requested: string): Promise<IdeActionResult> {
    try {
      const { abs, rel } = resolveProjectPath(this.projectRoot, requested)
      const result = await this.rt.lsp.diagnose(abs)
      return { ok: result.ok, error: result.missing, metadata: { path: rel, ...result } }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }

  async terminal(command: string, approved = false, timeoutMs = 120_000): Promise<IdeActionResult> {
    const clean = command.trim()
    if (!clean) return { ok: false, error: "command required" }
    if (clean.length > MAX_TERMINAL_COMMAND) return { ok: false, error: "command is too long" }
    const level = this.permissionFor("bash", clean)
    if (level === "deny") return { ok: false, error: "command denied by the active security profile" }
    if (level === "ask" && !approved) return { ok: false, needsApproval: true, error: "approval required for this command" }
    const bash = this.rt.tools.get("bash")
    if (!bash) return { ok: false, error: "bash tool is unavailable" }
    const result = await bash.execute(
      { command: clean, timeout: Math.min(Math.max(timeoutMs, 1_000), MAX_TERMINAL_TIMEOUT) },
      this.toolContext(approved),
    )
    this.rt.pushAudit("terminal", clean.slice(0, 180), result.success ? "ok" : "failed")
    return { ok: result.success, output: result.output, metadata: result.metadata }
  }

  async gitStatus(): Promise<GitStatusResult> {
    const result = await runProcess("git", ["status", "--short", "--branch"], this.projectRoot)
    if (!result.success) return { ok: false, error: result.output, raw: result.output }
    const parsed = parseGitStatus(result.output === "(no output)" ? "" : result.output)
    return { ok: true, branch: parsed.branch, entries: parsed.entries, raw: result.output }
  }

  async gitDiff(path?: string, staged = false): Promise<IdeActionResult> {
    const args = ["diff", "--no-ext-diff", "--unified=3"]
    if (staged) args.push("--staged")
    if (path) {
      try {
        const resolvedPath = resolveProjectPath(this.projectRoot, path)
        args.push("--", resolvedPath.rel)
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    }
    const result = await runProcess("git", args, this.projectRoot)
    return { ok: result.success, output: result.output, error: result.success ? undefined : result.output }
  }

  readSpec(id: string) {
    const meta = this.rt.specs.readMeta(id)
    if (!meta) return { ok: false, error: "spec not found" }
    return {
      ok: true,
      meta,
      requirements: this.rt.specs.readDocument(id, "requirements") ?? "",
      design: this.rt.specs.readDocument(id, "design") ?? "",
      tasks: this.rt.specs.readDocument(id, "tasks") ?? "",
      parsedTasks: this.rt.specs.loadTasks(id),
    }
  }

  saveSpec(
    id: string,
    document: "requirements" | "design" | "tasks",
    content: string,
    approved = false,
  ): IdeActionResult {
    const meta = this.rt.specs.readMeta(id)
    if (!meta) return { ok: false, error: "spec not found" }
    const rel = this.rt.config.config.spec.outputDir + "/" + id + "/" + document + ".md"
    const level = this.permissionFor("edit", rel)
    if (level === "deny") return { ok: false, error: "spec editing is denied by the active security profile" }
    if (level === "ask" && !approved) return { ok: false, needsApproval: true, error: "approval required to save spec" }
    if (document === "requirements") this.rt.specs.writeRequirements(id, content)
    else if (document === "design") this.rt.specs.writeDesign(id, content)
    else this.rt.specs.writeTasks(id, content)
    this.rt.pushAudit("spec", "Saved " + id + "/" + document + ".md")
    return { ok: true }
  }
}
