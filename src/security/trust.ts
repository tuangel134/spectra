import { createHash } from "node:crypto"
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { configDir } from "../util/platform.js"

export type WorkspaceTrustState = "implicit" | "trusted" | "untrusted" | "changed"
export type WorkspaceFindingKind = "plugin" | "hook" | "mcp" | "claude"

export interface WorkspaceFinding {
  kind: WorkspaceFindingKind
  path: string
  executable: boolean
}

export interface WorkspaceTrustStatus {
  projectRoot: string
  state: WorkspaceTrustState
  trusted: boolean
  permanent: boolean
  once: boolean
  fingerprint: string
  findings: WorkspaceFinding[]
}

interface TrustRecord {
  fingerprint: string
  trustedAt: number
}

interface TrustDatabase {
  version: 1
  workspaces: Record<string, TrustRecord>
}

const HASH_CHUNK_BYTES = 64 * 1024
const MAX_DISCOVERED_FILES = 500
const SESSION_TRUST = new Map<string, string>()

const SENSITIVE_FILES: Array<{ path: string; kind: WorkspaceFindingKind; executable: boolean }> = [
  { path: ".mcp.json", kind: "mcp", executable: true },
  { path: ".spectra/mcp.json", kind: "mcp", executable: true },
  { path: ".opencode/mcp.json", kind: "mcp", executable: true },
  { path: ".claude/settings.json", kind: "claude", executable: true },
  { path: ".claude/settings.local.json", kind: "claude", executable: true },
]

const SENSITIVE_DIRS: Array<{
  path: string
  kind: WorkspaceFindingKind
  extensions: Set<string>
}> = [
  { path: ".spectra/plugins", kind: "plugin", extensions: new Set([".js", ".mjs", ".cjs"]) },
  { path: ".spectra/hooks", kind: "hook", extensions: new Set([".json"]) },
  { path: ".opencode/hooks", kind: "hook", extensions: new Set([".json"]) },
  { path: ".claude/hooks", kind: "hook", extensions: new Set([".json", ".js", ".mjs", ".cjs"]) },
]

function canonicalPath(path: string): string {
  let result: string
  try {
    result = realpathSync(path)
  } catch {
    result = resolve(path)
  }
  return process.platform === "win32" ? result.toLowerCase() : result
}

function toPortable(path: string): string {
  return path.split(sep).join("/")
}

function trustDatabasePath(): string {
  return join(configDir(), "trusted-workspaces.json")
}

function emptyDatabase(): TrustDatabase {
  return { version: 1, workspaces: {} }
}

function readDatabase(): TrustDatabase {
  const path = trustDatabasePath()
  if (!existsSync(path)) return emptyDatabase()
  try {
    const value = JSON.parse(readFileSync(path, "utf-8")) as Partial<TrustDatabase>
    if (value.version !== 1 || !value.workspaces || typeof value.workspaces !== "object") {
      return emptyDatabase()
    }
    return { version: 1, workspaces: value.workspaces }
  } catch {
    return emptyDatabase()
  }
}

function writeDatabase(database: TrustDatabase): void {
  const path = trustDatabasePath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(database, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
  renameSync(tmp, path)
}

function extension(path: string): string {
  const slash = path.lastIndexOf("/")
  const dot = path.lastIndexOf(".")
  return dot > slash ? path.slice(dot).toLowerCase() : ""
}

function walkFiles(root: string, extensions: Set<string>): string[] {
  const found: string[] = []
  const visit = (dir: string, depth: number): void => {
    if (depth > 4 || found.length >= MAX_DISCOVERED_FILES) return
    let names: string[]
    try {
      names = readdirSync(dir).sort()
    } catch {
      return
    }
    for (const name of names) {
      if (found.length >= MAX_DISCOVERED_FILES) return
      const full = join(dir, name)
      let stat: ReturnType<typeof lstatSync>
      try {
        stat = lstatSync(full)
      } catch {
        continue
      }
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) visit(full, depth + 1)
      else if (stat.isFile() && extensions.has(extension(name))) found.push(full)
    }
  }
  visit(root, 0)
  return found
}

export function scanWorkspaceTrustAssets(projectRoot: string): WorkspaceFinding[] {
  const root = canonicalPath(projectRoot)
  const findings: WorkspaceFinding[] = []

  for (const item of SENSITIVE_FILES) {
    const full = join(root, item.path)
    try {
      if (existsSync(full) && statSync(full).isFile()) {
        findings.push({ kind: item.kind, path: item.path, executable: item.executable })
      }
    } catch {
      // A race while scanning is non-fatal; the next status refresh will retry.
    }
  }

  for (const item of SENSITIVE_DIRS) {
    const dir = join(root, item.path)
    if (!existsSync(dir)) continue
    for (const full of walkFiles(dir, item.extensions)) {
      findings.push({
        kind: item.kind,
        path: toPortable(relative(root, full)),
        executable: true,
      })
    }
  }

  return findings.sort((a, b) => a.path.localeCompare(b.path))
}

function hashFile(hash: ReturnType<typeof createHash>, path: string): void {
  const fd = openSync(path, "r")
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES)
  try {
    while (true) {
      const bytes = readSync(fd, buffer, 0, buffer.length, null)
      if (bytes === 0) break
      hash.update(buffer.subarray(0, bytes))
    }
  } finally {
    closeSync(fd)
  }
}

function fingerprintWorkspace(projectRoot: string, findings: WorkspaceFinding[]): string {
  const root = canonicalPath(projectRoot)
  const hash = createHash("sha256")
  hash.update(root)
  hash.update("\0")

  for (const finding of findings) {
    hash.update(finding.kind)
    hash.update("\0")
    hash.update(finding.path)
    hash.update("\0")
    const full = join(root, finding.path)
    try {
      const stat = statSync(full)
      hash.update(String(stat.size))
      hash.update("\0")
      // Hash the complete executable asset in fixed-size chunks. Prefix-only
      // hashing would let a same-size change beyond the prefix retain trust.
      hashFile(hash, full)
    } catch {
      hash.update("missing")
    }
    hash.update("\0")
  }

  return hash.digest("hex")
}

export class WorkspaceTrustManager {
  readonly projectRoot: string
  private trustedOnceFingerprint: string | null = null

  constructor(projectRoot: string) {
    this.projectRoot = canonicalPath(projectRoot)
  }

  status(): WorkspaceTrustStatus {
    const findings = scanWorkspaceTrustAssets(this.projectRoot)
    const fingerprint = fingerprintWorkspace(this.projectRoot, findings)

    if (findings.length === 0) {
      return {
        projectRoot: this.projectRoot,
        state: "implicit",
        trusted: true,
        permanent: false,
        once: false,
        fingerprint,
        findings,
      }
    }

    if (this.trustedOnceFingerprint === fingerprint || SESSION_TRUST.get(this.projectRoot) === fingerprint) {
      return {
        projectRoot: this.projectRoot,
        state: "trusted",
        trusted: true,
        permanent: false,
        once: true,
        fingerprint,
        findings,
      }
    }

    const record = readDatabase().workspaces[this.projectRoot]
    if (record?.fingerprint === fingerprint) {
      return {
        projectRoot: this.projectRoot,
        state: "trusted",
        trusted: true,
        permanent: true,
        once: false,
        fingerprint,
        findings,
      }
    }

    return {
      projectRoot: this.projectRoot,
      state: record ? "changed" : "untrusted",
      trusted: false,
      permanent: false,
      once: false,
      fingerprint,
      findings,
    }
  }

  isTrusted(): boolean {
    return this.status().trusted
  }

  trustOnce(): WorkspaceTrustStatus {
    const status = this.status()
    this.trustedOnceFingerprint = status.fingerprint
    SESSION_TRUST.set(this.projectRoot, status.fingerprint)
    return this.status()
  }

  trustPermanently(): WorkspaceTrustStatus {
    const status = this.status()
    const database = readDatabase()
    database.workspaces[this.projectRoot] = {
      fingerprint: status.fingerprint,
      trustedAt: Date.now(),
    }
    writeDatabase(database)
    this.trustedOnceFingerprint = null
    SESSION_TRUST.delete(this.projectRoot)
    return this.status()
  }

  restrict(): WorkspaceTrustStatus {
    this.trustedOnceFingerprint = null
    SESSION_TRUST.delete(this.projectRoot)
    const database = readDatabase()
    if (database.workspaces[this.projectRoot]) {
      delete database.workspaces[this.projectRoot]
      writeDatabase(database)
    }
    return this.status()
  }

  /** Test/support helper: remove the persisted trust database. */
  static clearDatabase(): void {
    SESSION_TRUST.clear()
    rmSync(trustDatabasePath(), { force: true })
  }
}
