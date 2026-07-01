import { test } from "node:test"
import assert from "node:assert/strict"

import { FREEBUFF_MODELS, FREEBUFF_DEFAULT_BASE, detectFreebuffToken, hasFreebuffToken } from "../src/provider/freebuff.ts"
import { ProviderRegistry } from "../src/provider/registry.ts"
import { DEFAULT_CONFIG } from "../src/config/defaults.ts"

test("Freebuff bundled models are non-empty and well-formed", () => {
  assert.ok(FREEBUFF_MODELS.length > 0)
  for (const m of FREEBUFF_MODELS) {
    assert.equal(typeof m.id, "string")
    assert.equal(typeof m.context, "number")
  }
  assert.match(FREEBUFF_DEFAULT_BASE, /\/v1$/)
})

test("detectFreebuffToken returns null when not logged in", () => {
  // In CI / this environment there's no freebuff CLI login.
  const token = detectFreebuffToken()
  assert.ok(token === null || typeof token === "string")
})

test("freebuff provider resolves with the proxy base URL", () => {
  const registry = new ProviderRegistry(structuredClone(DEFAULT_CONFIG))
  const resolved = registry.resolve("freebuff/deepseek-v4-pro")
  assert.equal(resolved.providerId, "freebuff")
  assert.equal(resolved.sdk, "openai-compatible")
  assert.match(resolved.baseURL, /\/v1$/)
  assert.equal(resolved.info.contextWindow, 128_000)
})

test("freebuff hasCredentials reflects token presence", () => {
  const registry = new ProviderRegistry(structuredClone(DEFAULT_CONFIG))
  assert.equal(registry.hasCredentials("freebuff"), hasFreebuffToken())
})
