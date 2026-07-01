import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer as httpServer, type Server } from "node:http"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createRuntime } from "../src/runtime.ts"
import { createServer } from "../src/server/index.ts"

/** Fake LLM: first call writes a guarded file, then says done. */
function fakeLlm(): Promise<{ server: Server; port: number }> {
  let n = 0
  const server = httpServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      n++
      const payload =
        n === 1
          ? { choices: [{ message: { content: "writing", tool_calls: [{ id: "c1", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "guarded.txt", content: "secret" }) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
          : { choices: [{ message: { content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(payload))
    })
  })
  return new Promise((r) => server.listen(0, "127.0.0.1", () => {
    const a = server.address(); r({ server, port: typeof a === "object" && a ? a.port : 0 })
  }))
}

/** Drive a /api/chat SSE request, answering the first approval with `allow`. */
async function chatWithApproval(base: string, allow: boolean): Promise<void> {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "write a guarded file" }),
  })
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split("\n\n")
    buf = parts.pop() ?? ""
    for (const p of parts) {
      if (!p.startsWith("data:")) continue
      const ev = JSON.parse(p.slice(5).trim())
      if (ev.type === "approval") {
        await fetch(`${base}/api/approval`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: ev.id, allow }),
        })
      }
    }
  }
}

test("web supervised mode: denying an approval blocks the tool", async () => {
  const { server: llm, port } = await fakeLlm()
  const project = mkdtempSync(join(tmpdir(), "spectra-sup-"))
  const rt = createRuntime({ cwd: project })
  rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
  rt.config.config.model = "fake/m"
  rt.config.config.spec.detect = "off"
  rt.config.config.autoApprove = false // supervised
  rt.config.config.permission.edit = "ask" // write belongs to the "edit" group
  const srv = createServer(rt, { port: 4101, hostname: "127.0.0.1", cors: [], noAuth: true })
  await srv.listen()
  try {
    await chatWithApproval("http://127.0.0.1:4101", false)
    assert.equal(existsSync(join(project, "guarded.txt")), false, "denied write must NOT create the file")
  } finally {
    await srv.close(); llm.close(); rmSync(project, { recursive: true, force: true })
  }
})

test("web supervised mode: approving an approval allows the tool", async () => {
  const { server: llm, port } = await fakeLlm()
  const project = mkdtempSync(join(tmpdir(), "spectra-sup2-"))
  const rt = createRuntime({ cwd: project })
  rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
  rt.config.config.model = "fake/m"
  rt.config.config.spec.detect = "off"
  rt.config.config.autoApprove = false // supervised
  rt.config.config.permission.edit = "ask"
  const srv = createServer(rt, { port: 4102, hostname: "127.0.0.1", cors: [], noAuth: true })
  await srv.listen()
  try {
    await chatWithApproval("http://127.0.0.1:4102", true)
    assert.equal(existsSync(join(project, "guarded.txt")), true, "approved write must create the file")
  } finally {
    await srv.close(); llm.close(); rmSync(project, { recursive: true, force: true })
  }
})


test("long-run guarantee: a full-access agent never blocks on approval, even supervised", async () => {
  const { server: llm, port } = await fakeLlm()
  const project = mkdtempSync(join(tmpdir(), "spectra-lr-"))
  const rt = createRuntime({ cwd: project })
  rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
  rt.config.config.model = "fake/m"
  rt.config.config.spec.detect = "off"
  // Worst case: supervised mode ON and edits set to "ask".
  rt.config.config.autoApprove = false
  rt.config.config.permission.edit = "ask"
  try {
    // The Autopilot uses a full-access agent (permission "*": "allow"), so tools
    // resolve to "allow" and never call requestApproval — a denying handler here
    // would throw if it were ever consulted.
    const fullAccess = { ...rt.agents.get("build")!, permission: { "*": "allow" as const }, allowedTools: null }
    const session = rt.sessions.create(fullAccess.id, "fake/m")
    let approvalAsked = false
    await rt.loop.run({
      sessionId: session.id,
      agent: fullAccess,
      userMessage: "write a guarded file",
      handlers: {
        onText() {}, onToolStart() {}, onToolEnd() {}, report() {},
        requestApproval: async () => { approvalAsked = true; return false },
      },
    })
    assert.equal(approvalAsked, false, "a full-access (autopilot) agent must never ask for approval")
    assert.equal(existsSync(join(project, "guarded.txt")), true, "the unattended write must go through")
  } finally {
    llm.close(); rmSync(project, { recursive: true, force: true })
  }
})
