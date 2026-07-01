import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer as httpServer, type Server } from "node:http"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createRuntime } from "../src/runtime.ts"
import type { LoopHandlers } from "../src/session/loop.ts"
import type { Agent } from "../src/agent/types.ts"

function fakeLlm(): Promise<{ server: Server; port: number }> {
  let n = 0
  const server = httpServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      n++
      const payload =
        n === 1
          ? { choices: [{ message: { content: "writing", tool_calls: [{ id: "c1", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "x.txt", content: "data" }) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
          : { choices: [{ message: { content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(payload))
    })
  })
  return new Promise((r) => server.listen(0, "127.0.0.1", () => {
    const a = server.address(); r({ server, port: typeof a === "object" && a ? a.port : 0 })
  }))
}

function makeRuntime(port: number, dir: string) {
  const rt = createRuntime({ cwd: dir })
  rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
  rt.config.config.model = "fake/m"
  rt.config.config.spec.detect = "off"
  return rt
}

test("agent-declared 'ask' is a hard gate — auto-approve cannot bypass it", async () => {
  const { server, port } = await fakeLlm()
  const dir = mkdtempSync(join(tmpdir(), "spectra-gate-"))
  try {
    const rt = makeRuntime(port, dir)
    rt.config.config.autoApprove = true // auto-approve ON globally
    let asked = false
    const agent: Agent = { ...rt.agents.get("build")!, permission: { edit: "ask" } } // security-style gate
    const handlers: LoopHandlers = {
      onText() {}, onToolStart() {}, onToolEnd() {}, report() {},
      requestApproval: async () => { asked = true; return false }, // user denies
    }
    const session = rt.sessions.create(agent.id, "fake/m")
    await rt.loop.run({ sessionId: session.id, agent, userMessage: "write x", handlers })
    assert.equal(asked, true, "the agent's 'ask' must still prompt despite auto-approve")
    assert.equal(existsSync(join(dir, "x.txt")), false, "a denied write must not happen")
  } finally {
    server.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test("auto-approve DOES bypass a global/project 'ask' (convenience)", async () => {
  const { server, port } = await fakeLlm()
  const dir = mkdtempSync(join(tmpdir(), "spectra-gate2-"))
  try {
    const rt = makeRuntime(port, dir)
    rt.config.config.autoApprove = true
    rt.config.config.permission.edit = "ask" // ask comes from config, not the agent
    let asked = false
    const agent: Agent = { ...rt.agents.get("build")!, permission: {} }
    const handlers: LoopHandlers = {
      onText() {}, onToolStart() {}, onToolEnd() {}, report() {},
      requestApproval: async () => { asked = true; return false },
    }
    const session = rt.sessions.create(agent.id, "fake/m")
    await rt.loop.run({ sessionId: session.id, agent, userMessage: "write x", handlers })
    assert.equal(asked, false, "auto-approve should answer a config-level 'ask' without prompting")
    assert.equal(existsSync(join(dir, "x.txt")), true, "the write should go through")
  } finally {
    server.close(); rmSync(dir, { recursive: true, force: true })
  }
})
