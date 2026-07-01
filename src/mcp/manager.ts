/**
 * MCP manager.
 *
 * Discovers MCP servers from config + `.spectra/mcp.json` + `.opencode/mcp.json`
 * (Claude/OpenCode-compatible), connects to each, and exposes their tools to
 * the agent as `mcp_<server>_<tool>` — so any MCP server works in Spectra with
 * zero glue code.
 */

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

import type { Tool, ToolContext, ToolResult } from "../tool/types.js"
import { McpStdioClient, type McpTransport } from "./client.js"
import { McpHttpClient } from "./http-client.js"
import type { McpServers, McpServerConfig, McpToolDef } from "./types.js"

export interface McpServerStatus {
  name: string
  connected: boolean
  type: string
  toolCount: number
  tools: string[]
  error?: string
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_")
}

/** Merge MCP server definitions from all supported config locations. */
export function loadMcpServers(projectRoot: string, fromConfig: McpServers = {}): McpServers {
  const merged: McpServers = { ...fromConfig }
  for (const rel of [".spectra/mcp.json", ".opencode/mcp.json", ".cursor/mcp.json"]) {
    const path = join(projectRoot, rel)
    if (!existsSync(path)) continue
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as { mcpServers?: McpServers }
      for (const [name, cfg] of Object.entries(parsed.mcpServers ?? {})) {
        merged[name] = { ...merged[name], ...cfg }
      }
    } catch {
      /* ignore malformed file */
    }
  }
  return merged
}

interface Connected {
  transport: McpTransport
  config: McpServerConfig
  tools: McpToolDef[]
}

export class McpManager {
  private readonly servers: McpServers
  private readonly connected = new Map<string, Connected>()
  private readonly errors = new Map<string, string>()

  constructor(projectRoot: string, fromConfig: McpServers = {}) {
    this.servers = loadMcpServers(projectRoot, fromConfig)
  }

  /** Connect to every enabled server and discover its tools. Best-effort. */
  async connectAll(report?: (msg: string) => void): Promise<void> {
    const entries = Object.entries(this.servers).filter(([, c]) => !c.disabled)
    const CONNECT_TIMEOUT = 15_000
    await Promise.all(
      entries.map(async ([name, config]) => {
        const transport: McpTransport = config.url
          ? new McpHttpClient(name, config)
          : new McpStdioClient(name, config)
        try {
          await Promise.race([
            transport.connect(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`timeout connecting to "${name}"`)), CONNECT_TIMEOUT),
            ),
          ])
          const tools = await transport.listTools()
          this.connected.set(name, { transport, config, tools })
          report?.(`MCP connected: ${name} (${tools.length} tools)`)
        } catch (err) {
          // Close the transport so a spawned child process isn't orphaned when
          // connect times out or listTools throws after the handshake.
          try {
            transport.close()
          } catch {
            /* ignore */
          }
          this.errors.set(name, (err as Error).message)
          report?.(`MCP failed: ${name} — ${(err as Error).message}`)
        }
      }),
    )
  }

  /** Build Spectra tool wrappers for every connected MCP tool. */
  toTools(): Tool[] {
    const out: Tool[] = []
    for (const [server, conn] of this.connected) {
      const auto = new Set(conn.config.autoApprove ?? [])
      for (const def of conn.tools) {
        const toolName = `mcp_${sanitize(server)}_${sanitize(def.name)}`
        out.push({
          name: toolName,
          description: `[MCP:${server}] ${def.description ?? def.name}`,
          category: "meta",
          availableToSubagents: true,
          parameters: (def.inputSchema as Record<string, unknown>) ?? {
            type: "object",
            properties: {},
            additionalProperties: true,
          },
          execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
            const level = ctx.permissionFor(toolName)
            if (level === "deny") return { success: false, output: `Error: ${toolName} denied by permissions.` }
            if (level === "ask" && !auto.has(def.name)) {
              const ok = await ctx.requestApproval(toolName, `Call MCP tool ${def.name} on ${server}`)
              if (!ok) return { success: false, output: `MCP call ${toolName} rejected by user.` }
            }
            try {
              const output = await conn.transport.callTool(def.name, args)
              return { success: true, output: output || "(no output)" }
            } catch (err) {
              return { success: false, output: `MCP error (${server}/${def.name}): ${(err as Error).message}` }
            }
          },
        })
      }
    }
    return out
  }

  status(): McpServerStatus[] {
    const out: McpServerStatus[] = []
    for (const [name, config] of Object.entries(this.servers)) {
      const conn = this.connected.get(name)
      out.push({
        name,
        connected: !!conn,
        type: config.url ? "http" : "stdio",
        toolCount: conn?.tools.length ?? 0,
        tools: conn?.tools.map((t) => t.name) ?? [],
        error: this.errors.get(name),
      })
    }
    return out
  }

  close(): void {
    for (const [, conn] of this.connected) conn.transport.close()
    this.connected.clear()
  }
}
