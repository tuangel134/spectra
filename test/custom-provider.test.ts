import test from "node:test"
import assert from "node:assert/strict"
import { normalizeOpenAIBaseURL, openAIEndpoint, fetchLiveModelsDetailed } from "../src/provider/model-catalog.js"

test("normalizes copied OpenAI-compatible endpoint URLs", () => {
  assert.equal(normalizeOpenAIBaseURL(" https://example.test/v1/chat/completions "), "https://example.test/v1")
  assert.equal(openAIEndpoint("https://example.test/v1/models", "models"), "https://example.test/v1/models")
})

test("model discovery understands common response shapes", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ models: [{ name: "alpha" }, { id: "beta" }, "gamma"] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch
  try {
    const result = await fetchLiveModelsDetailed("https://example.test/v1", "secret")
    assert.deepEqual(result.models, ["alpha", "beta", "gamma"])
    assert.equal(result.error, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("model discovery returns actionable HTTP diagnostics", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch
  try {
    const result = await fetchLiveModelsDetailed("https://example.test/v1", "bad")
    assert.deepEqual(result.models, [])
    assert.match(result.error ?? "", /401/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
