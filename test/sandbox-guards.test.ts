import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer as httpServer, type Server } from "node:http"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createRuntime } from "../src/runtime.ts"
import type { ToolContext } from "../src/tool/types.ts"

/** Fake LLM that returns a scripted tool call on turn `n`, then says done. */
function fakeLlm(script: (n: number) => { name: string; args: Record<string, unknown> } | null): Promise<{ server: Server; port: number }> {
  let n = 0
  const server = httpServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      n++
      const call = script(n)
      const payload = call
        ? { choices: [{ message: { content: "", tool_calls: [{ id: `c${n}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
        : { choices: [{ message: { content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(payload))
    })
  })
  return new Promise((r) => server.listen(0, "127.0.0.1", () => {
    const a = server.address(); r({ server, port: typeof a === "object" && a ? a.port : 0 })
  }))
}

const silent = () => ({
  onText() {}, onToolStart() {}, onToolEnd() {}, report() {},
  requestApproval: async () => true,
})

test("bench sandbox: retargeting config.projectRoot actually moves the agent's writes", async () => {
  // Regression: the loop captured projectRoot BY VALUE, so the benchmark
  // harness's temp-dir retarget was a no-op and the agent wrote into the real
  // project. The loop now reads projectRoot dynamically from the config.
  const { server, port } = await fakeLlm((n) => (n === 1 ? { name: "write", args: { path: "sandbox-out.txt", content: "hi" } } : null))
  const projDir = mkdtempSync(join(tmpdir(), "spectra-proj-"))
  const sandbox = mkdtempSync(join(tmpdir(), "spectra-sandbox-"))
  try {
    const rt = createRuntime({ cwd: projDir })
    rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
    rt.config.config.model = "fake/m"
    rt.config.config.spec.detect = "off"
    rt.config.config.autoApprove = true

    // Retarget the root the way the benchmark harness does.
    const orig = rt.config.projectRoot
    ;(rt.config as { projectRoot: string }).projectRoot = sandbox
    try {
      await rt.loop.run({ sessionId: rt.sessions.create("build", "fake/m").id, agent: rt.agents.get("build")!, userMessage: "write it", handlers: silent() })
    } finally {
      ;(rt.config as { projectRoot: string }).projectRoot = orig
    }

    assert.equal(existsSync(join(sandbox, "sandbox-out.txt")), true, "write must land in the retargeted sandbox dir")
    assert.equal(existsSync(join(projDir, "sandbox-out.txt")), false, "write must NOT land in the real project root")
  } finally {
    server.close(); rmSync(projDir, { recursive: true, force: true }); rmSync(sandbox, { recursive: true, force: true })
  }
})

test("subagent recursion guard: a delegated subagent cannot spawn further subagents", async () => {
  // Regression: `availableToSubagents:false` was dead code and the `task` filter
  // was skipped for full-access (allowedTools===null) subagents, so a subagent
  // could recursively call `task`. Now `task` is always stripped from a
  // subagent's tools. We delegate once and script the subagent to TRY calling
  // `task` again; it must be refused, so only ONE delegation is ever reported.
  const { server, port } = await fakeLlm((n) => (n === 1 ? { name: "task", args: { agent: "explore", prompt: "recurse" } } : null))
  const dir = mkdtempSync(join(tmpdir(), "spectra-recur-"))
  try {
    const rt = createRuntime({ cwd: dir })
    rt.providers.upsertProvider("fake", { sdk: "openai-compatible", baseURL: `http://127.0.0.1:${port}/v1`, options: { apiKey: "x" } })
    rt.config.config.model = "fake/m"

    const reports: string[] = []
    const ctx: ToolContext = {
      projectRoot: dir,
      agentId: "build",
      requestApproval: async () => true,
      report: (m: string) => reports.push(m),
      permissionFor: () => "allow",
    }
    const taskTool = rt.tools.get("task")!
    await taskTool.execute({ agent: "explore", prompt: "do a thing" }, ctx)

    const delegations = reports.filter((r) => r.includes("delegating to subagent")).length
    assert.equal(delegations, 1, "exactly one delegation — the subagent must not recurse via task")
  } finally {
    server.close(); rmSync(dir, { recursive: true, force: true })
  }
})
