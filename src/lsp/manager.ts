/**
 * LSP manager.
 *
 * Maps file extensions to language servers, lazily starts one server per
 * language (reused across files), and exposes `diagnose(file)` returning real
 * diagnostics. Servers are optional, locally-installed binaries; when a server
 * is missing we report it clearly instead of failing.
 */

import { readFileSync, existsSync } from "node:fs"
import { extname } from "node:path"

import { LspClient, type Diagnostic, type LspServerSpec } from "./client.js"

/** Default server command per language id. */
const SERVERS: Record<string, LspServerSpec> = {
  typescript: { command: "typescript-language-server", args: ["--stdio"], languageId: "typescript" },
  python: { command: "pyright-langserver", args: ["--stdio"], languageId: "python" },
  go: { command: "gopls", args: [], languageId: "go" },
  rust: { command: "rust-analyzer", args: [], languageId: "rust" },
}

const EXT_LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".mjs": "typescript",
  ".cjs": "typescript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
}

/** The language id Spectra would use for a file, or null if unsupported. */
export function languageForFile(file: string): string | null {
  return EXT_LANGUAGE[extname(file).toLowerCase()] ?? null
}

export interface DiagnoseResult {
  ok: boolean
  diagnostics: Diagnostic[]
  /** Set when no language server is available for the file. */
  unsupported?: boolean
  /** Set when the server binary is not installed. */
  missing?: string
}

export class LspManager {
  private readonly clients = new Map<string, LspClient | null>()

  constructor(
    private readonly projectRoot: string,
    private readonly servers: Record<string, LspServerSpec> = SERVERS,
  ) {}

  /** Override or add a server spec (e.g. from config). */
  setServer(languageId: string, spec: LspServerSpec): void {
    this.servers[languageId] = spec
  }

  /** Get (starting if needed) a client for a language; null if unavailable. */
  private async clientFor(languageId: string): Promise<LspClient | null> {
    if (this.clients.has(languageId)) return this.clients.get(languageId)!
    const spec = this.servers[languageId]
    if (!spec) {
      this.clients.set(languageId, null)
      return null
    }
    const client = new LspClient(spec, this.projectRoot)
    try {
      await client.start()
      this.clients.set(languageId, client)
      return client
    } catch {
      client.close()
      this.clients.set(languageId, null)
      return null
    }
  }

  /** Collect diagnostics for a single file. */
  async diagnose(absPath: string): Promise<DiagnoseResult> {
    const languageId = languageForFile(absPath)
    if (!languageId) return { ok: false, diagnostics: [], unsupported: true }
    if (!existsSync(absPath)) return { ok: false, diagnostics: [], missing: "file not found" }

    const client = await this.clientFor(languageId)
    if (!client) {
      return { ok: false, diagnostics: [], missing: this.servers[languageId]?.command ?? languageId }
    }
    const text = readFileSync(absPath, "utf-8")
    const diagnostics = await client.diagnose(absPath, text)
    return { ok: true, diagnostics }
  }

  close(): void {
    for (const [, client] of this.clients) client?.close()
    this.clients.clear()
  }
}

export type { Diagnostic } from "./client.js"
