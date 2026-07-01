import { test } from "node:test"
import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import { createServer, type Server } from "node:http"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Repl } from "../src/tui/repl.ts"
import { createRuntime } from "../src/runtime.ts"
import { runSpecWorkflow } from "../src/workflow/spec-workflow.ts"
import type { LoopHandlers } from "../src/session/loop.ts"

/** A fake OpenAI-compatible server that branches on the prompt content. */
function fakeLlm(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const text = body.toLowerCase()
      let content = "ok"
      if (text.includes("clarifying questions")) {
        content = JSON.stringify([
          { question: "Which language?", options: ["TypeScript", "Go"] },
          { question: "Which database?", options: ["SQLite", "Postgres"] },
        ])
      } else if (text.includes("complete requirements document")) {
        content = "# Requirements\n\n## Acceptance Criteria\n- When a user adds a task, the system shall persist it."
      } else if (text.includes("technical design document")) {
        content = "# Design\n\n## Architecture Overview\nA simple service."
      } else if (text.includes("task list in markdown")) {
        content =
          "# Tasks: todo\n\n- [ ] Task 1: Set up project\n  - Dependencies: []\n  - Files: [src/index.ts]\n  - Validation: build passes\n"
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 5 } }))
    })
  })
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const addr = server.address()
    const port = typeof addr === "object" && addr ? addr.port : 0
    resolve({ server, port })
  }))
}

function driveRepl(rt: ReturnType<typeof createRuntime>, lines: string[]): Promise<string> {
  const input = new PassThrough()
  const output = new PassThrough()
  let captured = ""
  output.on("data", (chunk) => (captured += chunk.toString()))
  const repl = new Repl(rt, { input, output })
  const done = repl.start().then(() => captured)
  let i = 0
  const feed = (): void => {
    if (i < lines.length) {
      input.write(lines[i] + "\n")
      i++
      setTimeout(feed, 20)
    } else {
      setTimeout(() => input.end(), 20)
    }
  }
  setTimeout(feed, 20)
  return done
}

test("REPL auto-detects a build request and runs the clarify→spec flow end to end", async () => {
  const { server, port } = await fakeLlm()
  const project = mkdtempSync(join(tmpdir(), "spectra-replspec-"))
  try {
    const rt = createRuntime({ cwd: project })
    rt.providers.upsertProvider("fake", {
      sdk: "openai-compatible",
      baseURL: `http://127.0.0.1:${port}/v1`,
      options: { apiKey: "x" },
    })
    rt.config.config.model = "fake/m"
    rt.config.config.small_model = "fake/m"
    rt.config.config.spec.detect = "ask"

    // Build prompt → choose "q" (questions) → answer the two questions → exit.
    const out = await driveRepl(rt, [
      "build a full-stack todo app with auth and tests",
      "q",
      "1", // Which language? → TypeScript
      "2", // Which database? → Postgres
      "/exit",
    ])

    // The decision prompt was shown.
    assert.match(out, /How should I spec it/)
    // Both clarifying questions were asked.
    assert.match(out, /Which language\?/)
    assert.match(out, /Which database\?/)

    // A spec was generated with all three documents.
    const specs = rt.specs.list()
    assert.ok(specs.length >= 1, "a spec should have been created")
    const id = specs[0]!.id
    assert.ok(rt.specs.readDocument(id, "requirements"))
    assert.ok(rt.specs.readDocument(id, "design"))
    const tasks = rt.specs.loadTasks(id)
    assert.ok(tasks.length >= 1, "tasks should parse from the generated tasks.md")
  } finally {
    server.close()
    rmSync(project, { recursive: true, force: true })
  }
})

test("REPL respects spec.detect = off (no interception)", async () => {
  const { server, port } = await fakeLlm()
  const project = mkdtempSync(join(tmpdir(), "spectra-reploff-"))
  try {
    const rt = createRuntime({ cwd: project })
    rt.providers.upsertProvider("fake", {
      sdk: "openai-compatible",
      baseURL: `http://127.0.0.1:${port}/v1`,
      options: { apiKey: "x" },
    })
    rt.config.config.model = "fake/m"
    rt.config.config.spec.detect = "off"

    const out = await driveRepl(rt, ["build a full-stack todo app with auth and tests", "/exit"])
    // No spec decision prompt; the message goes straight to a normal turn.
    assert.doesNotMatch(out, /How should I spec it/)
    assert.equal(rt.specs.list().length, 0)
  } finally {
    server.close()
    rmSync(project, { recursive: true, force: true })
  }
})


test("generating a spec does not hijack the user's chat session", async () => {
  const { server, port } = await fakeLlm()
  const project = mkdtempSync(join(tmpdir(), "spectra-hijack-"))
  try {
    const rt = createRuntime({ cwd: project })
    rt.providers.upsertProvider("fake", {
      sdk: "openai-compatible",
      baseURL: `http://127.0.0.1:${port}/v1`,
      options: { apiKey: "x" },
    })
    rt.config.config.model = "fake/m"

    // Simulate the UI's chat session.
    const chat = rt.sessions.create("build", "fake/m")
    assert.equal(rt.sessions.current()?.id, chat.id)

    const silent: LoopHandlers = {
      onText() {}, onToolStart() {}, onToolEnd() {}, report() {}, requestApproval: async () => true,
    }
    await runSpecWorkflow(rt, "build a todo API with auth", silent, [])

    // The spec used isolated sessions, so the chat session is still active.
    assert.equal(rt.sessions.current()?.id, chat.id, "spec generation must not hijack the chat session")
    assert.ok(rt.sessions.list().length > 1, "isolated spec sessions are still tracked")
  } finally {
    server.close()
    rmSync(project, { recursive: true, force: true })
  }
})
