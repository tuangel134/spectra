/**
 * Model Context Protocol (MCP) — shared types.
 *
 * Spectra speaks MCP so it can use the same servers as Claude Code, OpenCode,
 * Cursor and Kiro: spawn a server, discover its tools, and expose them to the
 * agent as first-class tools (named `mcp_<server>_<tool>`).
 */

/** A tool advertised by an MCP server. */
export interface McpToolDef {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/** One configured MCP server. */
export interface McpServerConfig {
  /** Transport: a local process (stdio) or a remote endpoint (http/sse). */
  type?: "stdio" | "http" | "sse"
  /** stdio: executable to launch. */
  command?: string
  /** stdio: arguments. */
  args?: string[]
  /** stdio: extra environment variables. */
  env?: Record<string, string>
  /** http/sse: server URL. */
  url?: string
  /** http/sse: extra headers (e.g. Authorization). */
  headers?: Record<string, string>
  /** Disable without removing the entry. */
  disabled?: boolean
  /** Tool names to auto-approve (skip the permission prompt). */
  autoApprove?: string[]
}

export type McpServers = Record<string, McpServerConfig>

/** A normalized JSON-RPC 2.0 message. */
export interface JsonRpcMessage {
  jsonrpc: "2.0"
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export const MCP_PROTOCOL_VERSION = "2024-11-05"
