import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AddressInfo } from "node:net"

import { ProviderRegistry } from "../src/provider/registry.ts"
import { ToolRegistry } from "../src/tool/registry.ts"
import { SessionManager } from "../src/session/manager.ts"
import { AgentLoop } from "../src/session/loop.ts"
import { AgentRegistry } from "../src/agent/registry.ts"
import { DEFAULT_CONFIG } from "../src/config/defaults.ts"
import type { SpectraConfig } from "../src/config/types.ts"
import type { LoopHandlers } from "../src/session/loop.ts"

/**
 * A fake OpenAI-compatible server that returns scripted responses.
 * The first call asks for a tool, the second returns final text.
 */
function startFakeLLM(responses: unknown[]): Promise<{ url: string; server: Server }> {
  let call = 0
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const response = responses[Math.min(call, responses.length - 1)]
      call++
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(response))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port
      resolve({ url: `http://127.0.0.1:${port}/v1`, server })
    })
  })
}

function silentHandlers(): LoopHandlers {
  return {
    onText: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    report: () => {},
    requestApproval: async () => true,
  }
}

test("agent loop executes a tool call then returns final text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-loop-"))
  try {
    const { url, server } = await startFakeLLM([
      // First response: request a write tool call.
      {
        choices: [
          {
            message: {
              content: "Creating the file.",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "write",
                    arguments: JSON.stringify({ path: "out.txt", content: "generated" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
      // Second response: final answer, no tools.
      {
        choices: [{ message: { content: "Done." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      },
    ])

    const config: SpectraConfig = {
      ...structuredClone(DEFAULT_CONFIG),
      provider: {
        fake: { sdk: "openai-compatible", baseURL: url, options: { apiKey: "test" } },
      },
    }

    const providers = new ProviderRegistry(config)
    const tools = new ToolRegistry()
    const sessions = new SessionManager()
    const agents = new AgentRegistry(config)
    const loop = new AgentLoop({
      providers,
      tools,
      sessions,
      globalPermissions: config.permission,
      projectRoot: dir,
    })

    const build = agents.get("build")!
    const session = sessions.create(build.id, "fake/test-model")

    const result = await loop.run({
      sessionId: session.id,
      agent: { ...build, model: "fake/test-model" },
      userMessage: "Create out.txt",
      handlers: silentHandlers(),
    })

    server.close()

    assert.equal(result.finalText, "Done.")
    assert.equal(result.toolCalls, 1)
    assert.equal(result.changes.length, 1)
    assert.ok(existsSync(join(dir, "out.txt")))
    assert.equal(readFileSync(join(dir, "out.txt"), "utf-8"), "generated")

    // Token usage should accumulate across both calls.
    assert.equal(sessions.get(session.id)?.usage.inputTokens, 18)
    assert.equal(sessions.get(session.id)?.usage.outputTokens, 8)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("agent loop suggests the closest tool name on an unknown tool call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-loop3-"))
  try {
    // First: call a misspelled tool "writ". Second: final answer.
    const { url, server } = await startFakeLLM([
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                { id: "c1", type: "function", function: { name: "writ", arguments: "{}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] },
    ])

    const config: SpectraConfig = {
      ...structuredClone(DEFAULT_CONFIG),
      provider: { fake: { sdk: "openai-compatible", baseURL: url, options: { apiKey: "t" } } },
    }
    const providers = new ProviderRegistry(config)
    const tools = new ToolRegistry()
    const sessions = new SessionManager()
    const agents = new AgentRegistry(config)
    const loop = new AgentLoop({ providers, tools, sessions, globalPermissions: config.permission, projectRoot: dir })
    const build = agents.get("build")!
    const session = sessions.create(build.id, "fake/m")

    const result = await loop.run({
      sessionId: session.id,
      agent: { ...build, model: "fake/m" },
      userMessage: "go",
      handlers: silentHandlers(),
    })
    server.close()

    // The tool message fed back should contain a suggestion of the real tool.
    const toolMsg = sessions.get(session.id)?.messages.find((m) => m.role === "tool")
    assert.ok(toolMsg, "a tool result message should be recorded")
    assert.match(toolMsg!.content, /unknown tool "writ"/)
    assert.match(toolMsg!.content, /write/)
    assert.equal(result.finalText, "ok")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("agent loop returns immediately when model emits no tool calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-loop2-"))
  try {
    const { url, server } = await startFakeLLM([
      { choices: [{ message: { content: "Just an answer." }, finish_reason: "stop" }] },
    ])

    const config: SpectraConfig = {
      ...structuredClone(DEFAULT_CONFIG),
      provider: { fake: { sdk: "openai-compatible", baseURL: url, options: { apiKey: "x" } } },
    }
    const providers = new ProviderRegistry(config)
    const sessions = new SessionManager()
    const agents = new AgentRegistry(config)
    const loop = new AgentLoop({
      providers,
      tools: new ToolRegistry(),
      sessions,
      globalPermissions: config.permission,
      projectRoot: dir,
    })

    const build = agents.get("build")!
    const session = sessions.create(build.id, "fake/m")
    const result = await loop.run({
      sessionId: session.id,
      agent: { ...build, model: "fake/m" },
      userMessage: "hi",
      handlers: silentHandlers(),
    })
    server.close()

    assert.equal(result.finalText, "Just an answer.")
    assert.equal(result.toolCalls, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
