import { test } from "node:test"
import assert from "node:assert/strict"

import { zenSdkFamily, zenBaseURL } from "../src/provider/zen.ts"
import { ProviderRegistry } from "../src/provider/registry.ts"
import { DEFAULT_CONFIG } from "../src/config/defaults.ts"
import type { SpectraConfig } from "../src/config/types.ts"
import { parseRetryAfter } from "../src/provider/http.ts"
import { ProviderError } from "../src/provider/types.ts"
import { isExhaustionError } from "../src/routing/index.ts"

test("parseRetryAfter reads numeric seconds and HTTP dates", () => {
  assert.equal(parseRetryAfter("67334"), 67334)
  assert.equal(parseRetryAfter(null), undefined)
  assert.equal(parseRetryAfter("not-a-number"), undefined)
  const future = new Date(Date.now() + 60_000).toUTCString()
  const secs = parseRetryAfter(future)
  assert.ok(secs !== undefined && secs >= 55 && secs <= 60)
})

test("isExhaustionError recognizes a free-tier 429 with FreeUsageLimitError", () => {
  const err = new ProviderError(
    "Request failed with status 429",
    429,
    '{"error":{"type":"FreeUsageLimitError","message":"Rate limit exceeded"}}',
    67334,
  )
  assert.equal(isExhaustionError(err), true)
  assert.equal(err.retryAfter, 67334)
})

test("isExhaustionError ignores ordinary errors", () => {
  assert.equal(isExhaustionError(new ProviderError("bad request", 400, "")), false)
  assert.equal(isExhaustionError(new Error("syntax error")), false)
})


test("zenSdkFamily routes by model id prefix", () => {
  assert.equal(zenSdkFamily("claude-opus-4-8"), "anthropic")
  assert.equal(zenSdkFamily("qwen3.7-max"), "anthropic")
  assert.equal(zenSdkFamily("gpt-5.5"), "openai")
  assert.equal(zenSdkFamily("gemini-3.1-pro"), "openai-compatible")
  assert.equal(zenSdkFamily("deepseek-v4-pro"), "openai-compatible")
})

test("zenBaseURL returns the Zen v1 prefix", () => {
  assert.ok(zenBaseURL("claude-opus-4-8").endsWith("/zen/v1"))
})

function configWith(provider: SpectraConfig["provider"]): SpectraConfig {
  return { ...structuredClone(DEFAULT_CONFIG), provider }
}

test("registry resolves OpenCode Zen models with correct SDK", () => {
  const reg = new ProviderRegistry(configWith({ opencode: { options: { apiKey: "k" } } }))
  const opus = reg.resolve("opencode/claude-opus-4-8")
  assert.equal(opus.sdk, "anthropic")
  assert.equal(opus.apiKey, "k")
  assert.ok(opus.baseURL.includes("opencode.ai/zen"))

  const gpt = reg.resolve("opencode/gpt-5.5")
  assert.equal(gpt.sdk, "openai")
})

test("registry resolves custom base URL providers", () => {
  const reg = new ProviderRegistry(
    configWith({
      "my-api": {
        baseURL: "https://my-host.example/v1",
        sdk: "openai-compatible",
        options: { apiKey: "secret" },
      },
    }),
  )
  const model = reg.resolve("my-api/custom-model")
  assert.equal(model.baseURL, "https://my-host.example/v1")
  assert.equal(model.sdk, "openai-compatible")
  assert.equal(model.apiKey, "secret")
})

test("registry throws on unknown provider", () => {
  const reg = new ProviderRegistry(structuredClone(DEFAULT_CONFIG))
  assert.throws(() => reg.resolve("nonexistent/model"))
})

test("registry throws on malformed model string", () => {
  const reg = new ProviderRegistry(structuredClone(DEFAULT_CONFIG))
  assert.throws(() => reg.resolve("noslash"))
})
