import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveAnswer, type Flow } from "../src/tui/flow.ts"
import { connectFlow, modelFlow, type FlowResult } from "../src/tui/flows.ts"
import { createRuntime } from "../src/runtime.ts"
import { parseJsonc } from "../src/config/loader.ts"

/** Run a flow to completion by answering each step with a provided answer fn. */
async function runFlow(flow: Flow, answer: (step: { question: string }) => string): Promise<void> {
  const answers: string[] = []
  while (true) {
    const step = flow.next(answers)
    if (!step) break
    const raw = answer(step)
    const { value, error } = resolveAnswer(step, raw)
    if (error) throw new Error(`Unexpected validation error: ${error}`)
    answers.push(value!)
  }
  await flow.complete(answers)
}

test("resolveAnswer accepts index, value, and label for selections", () => {
  const step = {
    question: "pick",
    options: [
      { label: "OpenCode Zen", value: "opencode" },
      { label: "Anthropic", value: "anthropic" },
    ],
  }
  assert.equal(resolveAnswer(step, "1").value, "opencode")
  assert.equal(resolveAnswer(step, "anthropic").value, "anthropic")
  assert.equal(resolveAnswer(step, "OpenCode Zen").value, "opencode")
  assert.ok(resolveAnswer(step, "99").error)
})

test("resolveAnswer runs validators on text steps", () => {
  const step = { question: "url", validate: (v: string) => (v.startsWith("http") ? null : "bad") }
  assert.ok(resolveAnswer(step, "ftp://x").error)
  assert.equal(resolveAnswer(step, "https://x").value, "https://x")
})

function withRuntime(fn: (ctx: { rt: ReturnType<typeof createRuntime>; home: string }) => Promise<void>) {
  return async () => {
    const home = mkdtempSync(join(tmpdir(), "spectra-flow-home-"))
    const project = mkdtempSync(join(tmpdir(), "spectra-flow-proj-"))
    const prevHome = process.env["HOME"]
    process.env["HOME"] = home
    delete process.env["OPENCODE_API_KEY"]
    try {
      const rt = createRuntime({ cwd: project })
      await fn({ rt, home })
    } finally {
      if (prevHome !== undefined) process.env["HOME"] = prevHome
      rmSync(home, { recursive: true, force: true })
      rmSync(project, { recursive: true, force: true })
    }
  }
}

test(
  "connectFlow (OpenCode Zen) saves the key and sets a model",
  withRuntime(async ({ rt, home }) => {
    let result: FlowResult | null = null
    const flow = connectFlow(rt, (r) => (result = r))

    // Answer: provider "1" (opencode), then the API key.
    const answers = ["1", "sk-zen-suscripcion"]
    let i = 0
    await runFlow(flow, () => answers[i++]!)

    assert.ok(result, "onResult should fire")
    assert.equal(rt.providers.hasCredentials("opencode"), true)
    assert.equal(rt.config.config.model, "opencode/claude-sonnet-4-6")

    const cfg = join(home, ".config", "spectra", "spectra.jsonc")
    assert.ok(existsSync(cfg))
    const saved = parseJsonc(readFileSync(cfg, "utf-8")) as {
      provider: { opencode: { options: { apiKey: string } } }
    }
    assert.equal(saved.provider.opencode.options.apiKey, "sk-zen-suscripcion")
  }),
)

test(
  "connectFlow (custom) collects id, base URL, and key",
  withRuntime(async ({ rt, home }) => {
    const flow = connectFlow(rt, () => {})
    // provider 7 = custom, then id, baseURL, key
    const answers = ["7", "mi-api", "https://host.example/v1", "secret-key"]
    let i = 0
    await runFlow(flow, () => answers[i++]!)

    assert.equal(rt.providers.hasCredentials("mi-api"), true)
    const model = rt.providers.resolve("mi-api/whatever")
    assert.equal(model.baseURL, "https://host.example/v1")
    assert.equal(model.apiKey, "secret-key")

    const cfg = join(home, ".config", "spectra", "spectra.jsonc")
    const saved = parseJsonc(readFileSync(cfg, "utf-8")) as {
      provider: { "mi-api": { baseURL: string; options: { apiKey: string } } }
    }
    assert.equal(saved.provider["mi-api"].baseURL, "https://host.example/v1")
  }),
)

test(
  "connectFlow (Ollama) needs no key",
  withRuntime(async ({ rt }) => {
    const flow = connectFlow(rt, () => {})
    // provider 6 = ollama; flow should complete with just that answer.
    const answers = ["6"]
    let i = 0
    await runFlow(flow, () => answers[i++]!)
    assert.equal(rt.providers.hasCredentials("ollama"), true)
  }),
)

test(
  "modelFlow accepts a typed id when no providers are connected",
  withRuntime(async ({ rt, home }) => {
    let result: FlowResult | null = null
    const flow = modelFlow(rt, (r) => (result = r))
    await runFlow(flow, () => "opencode/claude-opus-4-8")

    assert.ok(result)
    assert.equal(rt.config.config.model, "opencode/claude-opus-4-8")
    const cfg = join(home, ".config", "spectra", "spectra.jsonc")
    const saved = parseJsonc(readFileSync(cfg, "utf-8")) as { model: string }
    assert.equal(saved.model, "opencode/claude-opus-4-8")
  }),
)
