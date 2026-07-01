import { test } from "node:test"
import assert from "node:assert/strict"

import { goSdkFamily, goBaseURL, GO_MODELS } from "../src/provider/zen.ts"
import { ProviderRegistry } from "../src/provider/registry.ts"
import { DEFAULT_CONFIG } from "../src/config/defaults.ts"
import { spectrumBar, spectrumAt, getTheme, THEMES } from "../src/tui/theme.ts"
import { stripAnsi } from "../src/tui/ansi.ts"

test("goSdkFamily routes Go models correctly", () => {
  assert.equal(goSdkFamily("minimax-m3"), "anthropic")
  assert.equal(goSdkFamily("qwen3.7-max"), "anthropic")
  assert.equal(goSdkFamily("glm-5.2"), "openai-compatible")
  assert.equal(goSdkFamily("kimi-k2.7-code"), "openai-compatible")
  assert.equal(goSdkFamily("deepseek-v4-flash"), "openai-compatible")
})

test("goBaseURL points at the Go gateway", () => {
  assert.ok(goBaseURL("glm-5.2").includes("/zen/go/v1"))
})

test("registry resolves opencode-go models", () => {
  const config = {
    ...structuredClone(DEFAULT_CONFIG),
    provider: { "opencode-go": { options: { apiKey: "go-key" } } },
  }
  const reg = new ProviderRegistry(config)

  const kimi = reg.resolve("opencode-go/kimi-k2.7-code")
  assert.equal(kimi.sdk, "openai-compatible")
  assert.equal(kimi.apiKey, "go-key")
  assert.ok(kimi.baseURL.includes("/zen/go/v1"))

  const minimax = reg.resolve("opencode-go/minimax-m3")
  assert.equal(minimax.sdk, "anthropic")
})

test("registry lists Go models", () => {
  const config = {
    ...structuredClone(DEFAULT_CONFIG),
    provider: { "opencode-go": { options: { apiKey: "k" } } },
  }
  const reg = new ProviderRegistry(config)
  const go = reg.list().find((p) => p.id === "opencode-go")
  assert.ok(go)
  assert.equal(go!.models.length, GO_MODELS.length)
})

test("spectrumBar produces a colored bar of the requested width", () => {
  const theme = getTheme("prism")
  const bar = spectrumBar(theme, 10)
  assert.equal(stripAnsi(bar).length, 10)
})

test("spectrumAt clamps and interpolates", () => {
  const theme = getTheme("aurora")
  // Should not throw and should wrap text.
  assert.ok(stripAnsi(spectrumAt(theme, 0, "x")) === "x")
  assert.ok(stripAnsi(spectrumAt(theme, 1, "y")) === "y")
  assert.ok(stripAnsi(spectrumAt(theme, 1.5, "z")) === "z")
})

test("getTheme falls back to default for unknown id", () => {
  assert.equal(getTheme("nonexistent").id, "prism")
  assert.equal(getTheme(undefined).id, "prism")
  assert.ok(Object.keys(THEMES).includes("ember"))
})

test("free provider needs no credentials and resolves via chat/completions", () => {
  const reg = new ProviderRegistry(structuredClone(DEFAULT_CONFIG))
  assert.equal(reg.hasCredentials("free"), true)
  const m = reg.resolve("free/deepseek-v4-flash-free")
  assert.equal(m.sdk, "openai-compatible")
  assert.equal(m.apiKey, undefined)
  assert.ok(m.baseURL.includes("/zen/v1"))
})

test("default model is the free model so it works out of the box", () => {
  assert.equal(DEFAULT_CONFIG.model.startsWith("free/"), true)
})
