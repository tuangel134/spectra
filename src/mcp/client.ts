/**
 * MCP stdio client.
 *
 * A dependency-free JSON-RPC 2.0 client that talks to an MCP server over its
 * stdin/stdout using newline-delimited JSON (the stdio transport). It performs
 * the initialize handshake, lists tools, and calls them.
 *
 * HTTP/SSE servers are handled by {@link McpHttpClient}.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"

import {
  type JsonRpcMessage,
  type McpServerConfig,
  type McpToolDef,
  MCP_PROTOCOL_VERSION,
} from "./types.js"

const DEFAULT_TIMEOUT = 30_000

export interface McpTransport {
  connect(): Promise<void>
  listTools(): Promise<McpToolDef[]>
  callTool(name: string, args: Record<string, unknown>): Promise<string>
  close(): void
}

interface Pending {
  resolve: (value: JsonRpcMessage) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Extract a plain-text payload from an MCP tool-call result. */
export function flattenContent(result: unknown): string {
  if (!result || typeof result !== "object") return String(result ?? "")
  const r = result as { content?: unknown; isError?: boolean }
  if (!Array.isArray(r.content)) return JSON.stringify(result)
  const parts: string[] = []
  for (const item of r.content) {
    if (item && typeof item === "object") {
      const it = item as { type?: string; text?: string; data?: string; resource?: { text?: string } }
      if (typeof it.text === "string") parts.push(it.text)
      else if (it.resource?.text) parts.push(it.resource.text)
      else if (it.type === "image") parts.push("[image content]")
      else parts.push(JSON.stringify(item))
    }
  }
  return parts.join("\n")
}

export class McpStdioClient implements McpTransport {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ""
  private nextId = 1
  private readonly pending = new Map<number | string, Pending>()
  private closed = false

  constructor(
    private readonly name: string,
    private readonly config: McpServerConfig,
  ) {}

  async connect(): Promise<void> {
    if (!this.config.command) throw new Error(`MCP server "${this.name}" has no command`)
    const child = spawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams
    this.child = child

    child.stdout.setEncoding("utf-8")
    child.stdout.on("data", (chunk: string) => this.onData(chunk))
    // Drain stderr — an unread stderr pipe fills its OS buffer and deadlocks a
    // chatty server (it blocks on write while we wait forever for stdout).
    child.stderr.setEncoding("utf-8")
    child.stderr.on("data", () => {})
    child.on("exit", () => {
      this.child = null
      this.failAll(new Error(`MCP server "${this.name}" exited`))
    })
    child.on("error", (err) => this.failAll(err))

    // Handshake: initialize → notifications/initialized.
    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: "spectra", version: "0.1.0" },
    })
    this.notify("notifications/initialized")
  }

  async listTools(): Promise<McpToolDef[]> {
    const res = await this.request("tools/list", {})
    const tools = (res.result as { tools?: McpToolDef[] })?.tools ?? []
    return tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.request("tools/call", { name, arguments: args })
    if (res.error) throw new Error(res.error.message)
    return flattenContent(res.result)
  }

  close(): void {
    this.closed = true
    this.child?.kill()
    this.child = null
    // Reject any in-flight requests so their callers don't hang until timeout.
    this.failAll(new Error(`MCP server "${this.name}" closed`))
  }

  // ── internals ──

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      let msg: JsonRpcMessage
      try {
        msg = JSON.parse(line) as JsonRpcMessage
      } catch {
        continue // ignore non-JSON log lines on stdout
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        p.resolve(msg)
      }
    }
  }

  private request(method: string, params: unknown): Promise<JsonRpcMessage> {
    if (!this.child || this.closed) return Promise.reject(new Error("MCP client not connected"))
    const id = this.nextId++
    const payload: JsonRpcMessage = { jsonrpc: "2.0", id, method, params }
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP "${this.name}" timed out on ${method}`))
      }, DEFAULT_TIMEOUT)
      this.pending.set(id, { resolve, reject, timer })
      this.child!.stdin.write(JSON.stringify(payload) + "\n")
    })
  }

  private notify(method: string, params?: unknown): void {
    if (!this.child) return
    const payload: JsonRpcMessage = { jsonrpc: "2.0", method, params }
    this.child.stdin.write(JSON.stringify(payload) + "\n")
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}
