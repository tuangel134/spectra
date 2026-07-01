import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { McpStdioClient, flattenContent } from "../src/mcp/client.ts"
import { McpManager, loadMcpServers } from "../src/mcp/manager.ts"
import type { ToolContext } from "../src/tool/types.ts"

const FAKE_SERVER = resolve(fileURLToPath(new URL("./fixtures/fake-mcp-server.mjs", import.meta.url)))

function ctx(): ToolContext {
  return {
    projectRoot: "/tmp",
    agentId: "t",
    requestApproval: async () => true,
    permissionFor: () => "allow",
    report: () => {},
  }
}

test("flattenContent extracts text from MCP tool results", () => {
  assert.equal(flattenContent({ content: [{ type: "text", text: "hello" }] }), "hello")
  assert.equal(flattenContent({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }), "a\nb")
})

test("McpStdioClient connects, lists, and calls tools on a real subprocess", async () => {
  const client = new McpStdioClient("fake", { command: "node", args: [FAKE_SERVER] })
  await client.connect()
  const tools = await client.listTools()
  assert.equal(tools.length, 1)
  assert.equal(tools[0]!.name, "echo")
  const out = await client.callTool("echo", { text: "spectra" })
  assert.equal(out, "echo: spectra")
  client.close()
})

test("McpManager connects servers and exposes prefixed tools", async () => {
  const mgr = new McpManager("/tmp", { fake: { command: "node", args: [FAKE_SERVER] } })
  await mgr.connectAll()
  const status = mgr.status()
  assert.equal(status[0]!.connected, true)
  assert.equal(status[0]!.toolCount, 1)

  const tools = mgr.toTools()
  const echo = tools.find((t) => t.name === "mcp_fake_echo")
  assert.ok(echo, "tool should be exposed as mcp_fake_echo")
  const result = await echo!.execute({ text: "hi" }, ctx())
  assert.equal(result.success, true)
  assert.equal(result.output, "echo: hi")
  mgr.close()
})

test("McpManager records an error for a server that fails to start", async () => {
  const mgr = new McpManager("/tmp", { broken: { command: "this-command-does-not-exist-xyz" } })
  await mgr.connectAll()
  const status = mgr.status()
  assert.equal(status[0]!.connected, false)
  assert.ok(status[0]!.error, "should record a connection error")
  mgr.close()
})

test("loadMcpServers merges config with .spectra/mcp.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-mcp-"))
  try {
    mkdirSync(join(dir, ".spectra"), { recursive: true })
    writeFileSync(
      join(dir, ".spectra", "mcp.json"),
      JSON.stringify({ mcpServers: { db: { command: "uvx", args: ["mcp-postgres"] } } }),
    )
    const merged = loadMcpServers(dir, { inline: { url: "https://x/mcp" } })
    assert.ok(merged["inline"], "config server present")
    assert.ok(merged["db"], "file server merged")
    assert.equal(merged["db"]!.command, "uvx")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
