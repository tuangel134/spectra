import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer as httpServer, type Server } from "node:http"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createRuntime } from "../src/runtime.ts"

function fakeLlm(): Promise<{ server: Server; port: number }> {
  let n = 0
  const server = httpServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      n++
      const payload =
        n === 1
          ? { choices: [{ message: { content: "writing", tool_calls: [{ id: "c1", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "note.txt", content: "hi" }) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
          : { choices: [{ message: { content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(payload))
    })
  })
  return new Promise((r) => server.listen(0, "127.0.0.1", () => {
    const a = server.address(); r({ server, port: typeof a === "object" && a ? a.port : 0 })
  }))
}

function writeHook(dir: string, name: string, hook: unknown) {
  mkdirSync(join(dir, ".spectra", "hooks"), { recursive: true })
  writeFileSync(join(dir, ".spectra", "hooks", `${name}.json`), JSON.stringify(hook))
}

const silent = { onText() {}, onToolStart() {}, onToolEnd() {}, report() {}, requestApproval: async () => true }

test("promptSubmit hook fires and its runCommand output is fed back", async () => {
  const { server, port } = await fakeLlm()
  const dir = mkdtempSync(join(tmpdir(), "spectra-hook-"))
  writeHook(dir, "greet", { name: "greet", version: "1.0.0", when: { type: "promptSubmit" }, then: { type: "runCommand", command: "echo HOOK_FIRED" } })
  try {
    const rt = createRuntime({ cwd: dir }); rt.trust.trustOnce() // loads hooks from disk
    rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
    rt.config.config.model = "fake/m"
    rt.config.config.spec.detect = "off"
    const session = rt.sessions.create("build", "fake/m")
    await rt.loop.run({ sessionId: session.id, agent: rt.agents.get("build")!, userMessage: "say hi", handlers: silent })
    const msgs = rt.sessions.get(session.id)!.messages
    assert.ok(msgs.some((m) => m.role === "system" && /HOOK_FIRED/.test(m.content)), "promptSubmit hook output should be injected")
  } finally {
    server.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test("fileEdited/postToolUse hooks fire when the agent writes a file", async () => {
  const { server, port } = await fakeLlm()
  const dir = mkdtempSync(join(tmpdir(), "spectra-hook2-"))
  writeHook(dir, "onsave", { name: "onsave", version: "1.0.0", when: { type: "fileCreated", patterns: ["*.txt"] }, then: { type: "runCommand", command: "echo SAVED_HOOK" } })
  try {
    const rt = createRuntime({ cwd: dir }); rt.trust.trustOnce()
    rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
    rt.config.config.model = "fake/m"
    rt.config.config.spec.detect = "off"
    const session = rt.sessions.create("build", "fake/m")
    await rt.loop.run({ sessionId: session.id, agent: rt.agents.get("build")!, userMessage: "write a note", handlers: silent })
    const msgs = rt.sessions.get(session.id)!.messages
    assert.ok(msgs.some((m) => m.role === "system" && /SAVED_HOOK/.test(m.content)), "fileCreated hook should fire on the write")
  } finally {
    server.close(); rmSync(dir, { recursive: true, force: true })
  }
})
