import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { staticCatalog } from "../src/provider/catalog.ts"
import { modelFlow } from "../src/tui/flows.ts"
import { resolveAnswer, type Flow } from "../src/tui/flow.ts"
import { createRuntime } from "../src/runtime.ts"
import { parseJsonc } from "../src/config/loader.ts"

test("staticCatalog spans free, zen, go, and direct providers", () => {
  const cat = staticCatalog()
  const providers = new Set(cat.map((e) => e.providerId))
  assert.ok(providers.has("free"))
  assert.ok(providers.has("opencode"))
  assert.ok(providers.has("opencode-go"))
  assert.ok(providers.has("anthropic"))
  assert.ok(providers.has("openai"))
  // Free entries are flagged.
  assert.ok(cat.some((e) => e.free && e.providerId === "free"))
})

async function runFlow(flow: Flow, answers: string[]): Promise<void> {
  const given: string[] = []
  let i = 0
  while (true) {
    const step = flow.next(given)
    if (!step) break
    const { value, error } = resolveAnswer(step, answers[i++]!)
    if (error) throw new Error(error)
    given.push(value!)
  }
  await flow.complete(given)
}

function withRuntime(fn: (rt: ReturnType<typeof createRuntime>, home: string) => Promise<void>) {
  return async () => {
    const home = mkdtempSync(join(tmpdir(), "spectra-cat-home-"))
    const project = mkdtempSync(join(tmpdir(), "spectra-cat-proj-"))
    const prev = process.env["HOME"]
    const prevXdg = process.env["XDG_CONFIG_HOME"]
    const prevAppData = process.env["APPDATA"]
    process.env["HOME"] = home
    process.env["XDG_CONFIG_HOME"] = join(home, ".config")
    process.env["APPDATA"] = join(home, "AppData", "Roaming")
    delete process.env["OPENCODE_API_KEY"]
    delete process.env["ANTHROPIC_API_KEY"]
    try {
      await fn(createRuntime({ cwd: project }), home)
    } finally {
      if (prev !== undefined) process.env["HOME"] = prev
      if (prevXdg !== undefined) process.env["XDG_CONFIG_HOME"] = prevXdg
      else delete process.env["XDG_CONFIG_HOME"]
      if (prevAppData !== undefined) process.env["APPDATA"] = prevAppData
      else delete process.env["APPDATA"]
      rmSync(home, { recursive: true, force: true })
      rmSync(project, { recursive: true, force: true })
    }
  }
}

test(
  "modelFlow sets a free model without asking for a key",
  withRuntime(async (rt) => {
    const flow = modelFlow(rt, () => {})
    await runFlow(flow, ["free/qwen3.6-plus-free"])
    assert.equal(rt.config.config.model, "free/qwen3.6-plus-free")
  }),
)

test(
  "modelFlow asks for a key inline when the provider is not connected",
  withRuntime(async (rt, home) => {
    const flow = modelFlow(rt, () => {})
    // Pick an Anthropic model (needs key), then provide it inline.
    await runFlow(flow, ["anthropic/claude-sonnet-4-5", "sk-ant-key"])
    assert.equal(rt.config.config.model, "anthropic/claude-sonnet-4-5")
    assert.equal(rt.providers.hasCredentials("anthropic"), true)
    const cfg = join(home, ".config", "spectra", "spectra.jsonc")
    assert.ok(existsSync(cfg))
    const saved = parseJsonc(readFileSync(cfg, "utf-8")) as {
      provider: { anthropic: { options: { apiKey: string } } }
    }
    assert.equal(saved.provider.anthropic.options.apiKey, "{secret:provider:anthropic}")
  }),
)
