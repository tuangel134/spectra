import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer as httpServer, type Server } from "node:http"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createRuntime } from "../src/runtime.ts"

/**
 * Fake OpenAI-compatible endpoint that streams an SSE response in the
 * Chat Completions delta format: a few text chunks, a usage frame, then [DONE].
 */
function fakeStreamLlm(): Promise<{ server: Server; port: number; sawStream: () => boolean }> {
  let sawStream = false
  const server = httpServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}") as { stream?: boolean }
      sawStream = parsed.stream === true
      res.writeHead(200, { "content-type": "text/event-stream" })
      const frames = [
        { choices: [{ delta: { content: "Hel" }, finish_reason: null }] },
        { choices: [{ delta: { content: "lo" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
        { usage: { prompt_tokens: 3, completion_tokens: 2 } },
      ]
      for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`)
      res.write("data: [DONE]\n\n")
      res.end()
    })
  })
  return new Promise((r) =>
    server.listen(0, "127.0.0.1", () => {
      const a = server.address()
      r({ server, port: typeof a === "object" && a ? a.port : 0, sawStream: () => sawStream })
    }),
  )
}

test("streaming: onTextChunk receives deltas and the full text is assembled", async () => {
  const { server, port, sawStream } = await fakeStreamLlm()
  const dir = mkdtempSync(join(tmpdir(), "spectra-stream-"))
  try {
    const rt = createRuntime({ cwd: dir })
    rt.providers.upsertProvider("fake", {
      sdk: "openai-compatible",
      baseURL: `http://127.0.0.1:${port}/v1`,
      options: { apiKey: "x" },
    })
    rt.config.config.model = "fake/m"
    rt.config.config.spec.detect = "off"
    const session = rt.sessions.create("build", "fake/m")

    const chunks: string[] = []
    let fullText = ""
    await rt.loop.run({
      sessionId: session.id,
      agent: rt.agents.get("build")!,
      userMessage: "say hello",
      handlers: {
        onText: (t) => { fullText = t },
        onTextChunk: (d) => { chunks.push(d) },
        onToolStart() {},
        onToolEnd() {},
        report() {},
        requestApproval: async () => true,
      },
    })

    assert.equal(sawStream(), true, "provider should have been called with stream:true")
    assert.deepEqual(chunks, ["Hel", "lo"], "each SSE content delta should be emitted as a chunk")
    assert.equal(fullText, "Hello", "the assembled assistant text should be the concatenated chunks")
    const msgs = rt.sessions.get(session.id)!.messages
    assert.ok(
      msgs.some((m) => m.role === "assistant" && m.content === "Hello"),
      "the streamed assistant message must be persisted in the session",
    )
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("streaming: non-streaming path still works when onTextChunk is absent", async () => {
  // A plain JSON (non-SSE) endpoint; loop must use complete() since no onTextChunk.
  let n = 0
  const server = httpServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      n++
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "plain reply" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      )
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0
  const dir = mkdtempSync(join(tmpdir(), "spectra-nostream-"))
  try {
    const rt = createRuntime({ cwd: dir })
    rt.providers.upsertProvider("fake", {
      sdk: "openai-compatible",
      baseURL: `http://127.0.0.1:${port}/v1`,
      options: { apiKey: "x" },
    })
    rt.config.config.model = "fake/m"
    rt.config.config.spec.detect = "off"
    const session = rt.sessions.create("build", "fake/m")
    let fullText = ""
    await rt.loop.run({
      sessionId: session.id,
      agent: rt.agents.get("build")!,
      userMessage: "hi",
      handlers: {
        onText: (t) => { fullText = t },
        onToolStart() {},
        onToolEnd() {},
        report() {},
        requestApproval: async () => true,
      },
    })
    assert.equal(fullText, "plain reply")
    assert.ok(n >= 1, "the non-streaming endpoint should have been hit")
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
