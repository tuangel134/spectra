/**
 * Language Server Protocol (LSP) client.
 *
 * Dependency-free JSON-RPC 2.0 client over stdio using LSP's Content-Length
 * framing. It performs the initialize handshake, opens documents, and collects
 * `textDocument/publishDiagnostics` notifications so the agent (and the
 * autopilot gate) can see real type/lint errors per file.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { pathToFileURL } from "node:url"

export interface Diagnostic {
  severity: "error" | "warning" | "info" | "hint"
  line: number
  column: number
  message: string
  source?: string
  code?: string | number
}

interface JsonRpc {
  jsonrpc: "2.0"
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

const SEVERITY: Record<number, Diagnostic["severity"]> = { 1: "error", 2: "warning", 3: "info", 4: "hint" }

interface Pending {
  resolve: (msg: JsonRpc) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface LspServerSpec {
  command: string
  args: string[]
  /** LSP language id (e.g. "typescript", "python"). */
  languageId: string
}

export class LspClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private readonly pending = new Map<number | string, Pending>()
  /** Latest diagnostics keyed by file URI. */
  private readonly diagnostics = new Map<string, Diagnostic[]>()
  /** One-shot listeners awaiting diagnostics for a URI (with debounce state). */
  private readonly waiters = new Map<
    string,
    { resolve: (diags: Diagnostic[]) => void; hard: ReturnType<typeof setTimeout>; debounce?: ReturnType<typeof setTimeout> }
  >()
  private initialized = false
  private closed = false

  constructor(
    private readonly spec: LspServerSpec,
    private readonly rootPath: string,
  ) {}

  async start(): Promise<void> {
    const child = spawn(this.spec.command, this.spec.args, {
      cwd: this.rootPath,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams
    this.child = child
    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk))
    // Drain stderr to avoid a full-pipe deadlock with chatty language servers.
    child.stderr.on("data", () => {})
    child.on("exit", () => this.failAll(new Error(`LSP "${this.spec.command}" exited`)))
    child.on("error", (err) => this.failAll(err))

    await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(this.rootPath).href,
      capabilities: {
        textDocument: { publishDiagnostics: { relatedInformation: true } },
      },
      clientInfo: { name: "spectra", version: "0.1.0" },
    })
    this.notify("initialized", {})
    this.initialized = true
  }

  get isInitialized(): boolean {
    return this.initialized
  }

  /** Open a document and wait up to `waitMs` for its diagnostics. */
  async diagnose(absPath: string, text: string, waitMs = 3500): Promise<Diagnostic[]> {
    const uri = pathToFileURL(absPath).href
    this.diagnostics.delete(uri)

    const got = new Promise<Diagnostic[]>((resolve) => {
      const hard = setTimeout(() => {
        const w = this.waiters.get(uri)
        if (w) {
          this.waiters.delete(uri)
          if (w.debounce) clearTimeout(w.debounce)
          resolve(this.diagnostics.get(uri) ?? [])
        }
      }, waitMs)
      this.waiters.set(uri, { resolve, hard })
    })

    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: this.spec.languageId, version: 1, text },
    })

    return got
  }

  close(): void {
    this.closed = true
    try {
      this.notify("shutdown", {})
    } catch {
      /* ignore */
    }
    this.child?.kill()
    this.child = null
  }

  // ── framing / transport ──

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    // Parse as many complete Content-Length framed messages as possible.
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd < 0) return
      const header = this.buffer.subarray(0, headerEnd).toString("utf-8")
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) return
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf-8")
      this.buffer = this.buffer.subarray(bodyStart + length)
      try {
        this.onMessage(JSON.parse(body) as JsonRpc)
      } catch {
        /* ignore malformed */
      }
    }
  }

  private onMessage(msg: JsonRpc): void {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      p.resolve(msg)
      return
    }
    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as { uri: string; diagnostics: unknown[] }
      const diags = (params.diagnostics ?? []).map((d): Diagnostic => {
        const dd = d as {
          severity?: number
          range: { start: { line: number; character: number } }
          message: string
          source?: string
          code?: string | number
        }
        return {
          severity: SEVERITY[dd.severity ?? 1] ?? "error",
          line: dd.range.start.line + 1,
          column: dd.range.start.character + 1,
          message: dd.message,
          source: dd.source,
          code: dd.code,
        }
      })
      this.diagnostics.set(params.uri, diags)
      const w = this.waiters.get(params.uri)
      if (w) {
        // Many servers publish an empty diagnostics array first, then the real
        // errors in a follow-up message. Debounce: resolve a short quiet period
        // after the LATEST publish (capped by the hard timeout) so we don't fire
        // on the initial empty batch and report a broken file as clean.
        if (w.debounce) clearTimeout(w.debounce)
        w.debounce = setTimeout(() => {
          this.waiters.delete(params.uri)
          clearTimeout(w.hard)
          w.resolve(this.diagnostics.get(params.uri) ?? [])
        }, 600)
      }
    }
  }

  private send(msg: JsonRpc): void {
    if (!this.child || this.closed) return
    const body = JSON.stringify(msg)
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`)
  }

  private request(method: string, params: unknown, timeoutMs = 20_000): Promise<JsonRpc> {
    if (!this.child || this.closed) return Promise.reject(new Error("LSP not started"))
    const id = this.nextId++
    return new Promise<JsonRpc>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`LSP "${this.spec.command}" timed out on ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: "2.0", id, method, params })
    })
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params })
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}
