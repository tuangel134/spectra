/**
 * MCP HTTP client (streamable HTTP transport).
 *
 * Posts JSON-RPC requests to a single endpoint and parses either a JSON body or
 * an SSE-framed (`data: {...}`) response. Covers remote MCP servers reachable
 * over HTTP, the way OpenCode/Cursor consume hosted MCP endpoints.
 */

import {
  type JsonRpcMessage,
  type McpServerConfig,
  type McpToolDef,
  MCP_PROTOCOL_VERSION,
} from "./types.js"
import { flattenContent, type McpTransport } from "./client.js"

const DEFAULT_TIMEOUT = 30_000

/** Parse a response body that may be plain JSON or SSE (`data:` lines). */
function parseBody(body: string): JsonRpcMessage | null {
  const trimmed = body.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as JsonRpcMessage
    } catch {
      return null
    }
  }
  // SSE: take the last `data:` line that parses as a JSON-RPC result.
  let last: JsonRpcMessage | null = null
  for (const line of trimmed.split("\n")) {
    const m = line.match(/^data:\s*(.*)$/)
    if (!m) continue
    try {
      last = JSON.parse(m[1]!) as JsonRpcMessage
    } catch {
      /* ignore */
    }
  }
  return last
}

export class McpHttpClient implements McpTransport {
  private nextId = 1
  private sessionId: string | null = null

  constructor(
    private readonly name: string,
    private readonly config: McpServerConfig,
  ) {}

  private get url(): string {
    if (!this.config.url) throw new Error(`MCP server "${this.name}" has no url`)
    return this.config.url
  }

  async connect(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: "spectra", version: "0.1.0" },
    })
    // Best-effort initialized notification.
    await this.send("notifications/initialized", undefined, true).catch(() => {})
  }

  async listTools(): Promise<McpToolDef[]> {
    const res = await this.rpc("tools/list", {})
    return (res.result as { tools?: McpToolDef[] })?.tools ?? []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.rpc("tools/call", { name, arguments: args })
    if (res.error) throw new Error(res.error.message)
    return flattenContent(res.result)
  }

  close(): void {
    /* stateless */
  }

  private async rpc(method: string, params: unknown): Promise<JsonRpcMessage> {
    const msg = await this.send(method, params, false)
    if (!msg) throw new Error(`MCP "${this.name}" returned an empty response for ${method}`)
    return msg
  }

  private async send(method: string, params: unknown, notification: boolean): Promise<JsonRpcMessage | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)
    const payload: JsonRpcMessage = notification
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id: this.nextId++, method, params }
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(this.config.headers ?? {}),
      }
      if (this.sessionId) headers["mcp-session-id"] = this.sessionId
      const res = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const sid = res.headers.get("mcp-session-id")
      if (sid) this.sessionId = sid
      if (notification) return null
      const text = await res.text()
      if (!res.ok) {
        throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`)
      }
      return parseBody(text)
    } finally {
      clearTimeout(timer)
    }
  }
}
