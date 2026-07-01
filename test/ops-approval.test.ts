import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer as httpServer, type Server } from "node:http"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createRuntime } from "../src/runtime.ts"

/** Fake LLM: first call issues one tool call, then says done. */
function fakeLlm(toolName: string, args: Record<string, unknown>): Promise<{ server: Server; port: number }> {
  let n = 0
  const server = httpServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      n++
      const payload =
        n === 1
          ? { choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: toolName, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
          : { choices: [{ message: { content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(payload))
    })
  })
  return new Promise((r) => server.listen(0, "127.0.0.1", () => {
    const a = server.address(); r({ server, port: typeof a === "object" && a ? a.port : 0 })
  }))
}

const silent = (onAsk: (t: string) => void, allow: boolean) => ({
  onText() {}, onToolStart() {}, onToolEnd() {}, report() {},
  requestApproval: async (tool: string) => { onAsk(tool); return allow },
})

test("ops agent: a sudo command is gated even when autoApprove is ON", async () => {
  const { server, port } = await fakeLlm("bash", { command: "sudo -n true" })
  const dir = mkdtempSync(join(tmpdir(), "spectra-ops-"))
  try {
    const rt = createRuntime({ cwd: dir })
    rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
    rt.config.config.model = "fake/m"
    rt.config.config.spec.detect = "off"
    rt.config.config.autoApprove = true // full auto — the sudo gate must still fire
    let asked = ""
    await rt.loop.run({ sessionId: rt.sessions.create("ops", "fake/m").id, agent: rt.agents.get("ops")!, userMessage: "check", handlers: silent((t) => { asked = t }, false) })
    assert.equal(asked, "bash", "a sudo command must ask for approval despite autoApprove")
  } finally {
    server.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test("build agent: an ordinary command is NOT gated under autoApprove", async () => {
  const { server, port } = await fakeLlm("bash", { command: "echo hello" })
  const dir = mkdtempSync(join(tmpdir(), "spectra-ops2-"))
  try {
    const rt = createRuntime({ cwd: dir })
    rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
    rt.config.config.model = "fake/m"
    rt.config.config.spec.detect = "off"
    rt.config.config.autoApprove = true
    let asked = ""
    await rt.loop.run({ sessionId: rt.sessions.create("build", "fake/m").id, agent: rt.agents.get("build")!, userMessage: "run", handlers: silent((t) => { asked = t }, true) })
    assert.equal(asked, "", "a normal command should auto-approve without asking")
  } finally {
    server.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test("default (build) agent: a sudo command is gated even under autoApprove", async () => {
  // The general default agent must keep the user in control of privileged system
  // actions — sudo asks for approval despite full auto-approve.
  const { server, port } = await fakeLlm("bash", { command: "sudo -n systemctl restart pipewire" })
  const dir = mkdtempSync(join(tmpdir(), "spectra-build-sudo-"))
  try {
    const rt = createRuntime({ cwd: dir })
    rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
    rt.config.config.model = "fake/m"
    rt.config.config.spec.detect = "off"
    rt.config.config.autoApprove = true
    let asked = ""
    await rt.loop.run({ sessionId: rt.sessions.create("build", "fake/m").id, agent: rt.agents.get("build")!, userMessage: "fix audio", handlers: silent((t) => { asked = t }, false) })
    assert.equal(asked, "bash", "a sudo command from the default agent must ask despite autoApprove")
  } finally {
    server.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test("external write is a mandatory gate even under autoApprove", async () => {
  const { server, port } = await fakeLlm("write", { path: "../spectra-escape.txt", content: "x" })
  const dir = mkdtempSync(join(tmpdir(), "spectra-ops3-"))
  const escape = join(dir, "..", "spectra-escape.txt")
  try {
    const rt = createRuntime({ cwd: dir })
    rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
    rt.config.config.model = "fake/m"
    rt.config.config.spec.detect = "off"
    rt.config.config.autoApprove = true
    let asked = ""
    await rt.loop.run({ sessionId: rt.sessions.create("build", "fake/m").id, agent: rt.agents.get("build")!, userMessage: "write", handlers: silent((t) => { asked = t }, false) })
    assert.equal(asked, "write", "an external write must ask even under autoApprove")
    assert.equal(existsSync(escape), false, "a denied external write must not create the file")
  } finally {
    server.close(); rmSync(dir, { recursive: true, force: true }); rmSync(escape, { force: true })
  }
})

test("a sudo invoked by ABSOLUTE PATH is still gated (wildcard is not anchored)", async () => {
  // Regression: the permission pattern used to be "sudo *", which — because the
  // matcher anchors ^...$ — only matched commands STARTING with "sudo ".
  // `/usr/bin/sudo …` slipped through. It is now "*sudo *".
  const { server, port } = await fakeLlm("bash", { command: "/usr/bin/sudo -n systemctl restart pipewire" })
  const dir = mkdtempSync(join(tmpdir(), "spectra-sudo-abs-"))
  try {
    const rt = createRuntime({ cwd: dir })
    rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
    rt.config.config.model = "fake/m"
    rt.config.config.spec.detect = "off"
    rt.config.config.autoApprove = true
    let asked = ""
    await rt.loop.run({ sessionId: rt.sessions.create("build", "fake/m").id, agent: rt.agents.get("build")!, userMessage: "fix audio", handlers: silent((t) => { asked = t }, false) })
    assert.equal(asked, "bash", "an absolute-path sudo must ask despite autoApprove")
  } finally {
    server.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test("a pkexec escalation is gated even under autoApprove", async () => {
  const { server, port } = await fakeLlm("bash", { command: "pkexec systemctl restart NetworkManager" })
  const dir = mkdtempSync(join(tmpdir(), "spectra-pkexec-"))
  try {
    const rt = createRuntime({ cwd: dir })
    rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
    rt.config.config.model = "fake/m"
    rt.config.config.spec.detect = "off"
    rt.config.config.autoApprove = true
    let asked = ""
    await rt.loop.run({ sessionId: rt.sessions.create("build", "fake/m").id, agent: rt.agents.get("build")!, userMessage: "fix wifi", handlers: silent((t) => { asked = t }, false) })
    assert.equal(asked, "bash", "a pkexec command must ask despite autoApprove")
  } finally {
    server.close(); rmSync(dir, { recursive: true, force: true })
  }
})
