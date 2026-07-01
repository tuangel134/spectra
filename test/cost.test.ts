import { test } from "node:test"
import assert from "node:assert/strict"

import { estimateCost, priceFor, summarizeCost } from "../src/util/cost.ts"

test("free and local models cost nothing", () => {
  assert.equal(estimateCost("free/deepseek-v4-flash-free", 1_000_000, 1_000_000), 0)
  assert.equal(estimateCost("ollama/llama3", 500_000, 500_000), 0)
})

test("opus is priced higher than haiku", () => {
  const opus = estimateCost("anthropic/claude-opus-4-8", 1_000_000, 1_000_000)
  const haiku = estimateCost("anthropic/claude-haiku-4-5", 1_000_000, 1_000_000)
  assert.ok(opus > haiku)
})

test("priceFor falls back to a mid-range estimate for unknown models", () => {
  const p = priceFor("acme/unknown-model")
  assert.ok(p.inPerM > 0 && p.outPerM > 0)
})

test("summarizeCost aggregates across sessions with different models", () => {
  const summary = summarizeCost([
    { model: "free/x", usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } },
    { model: "anthropic/claude-opus-4-8", usage: { inputTokens: 1_000_000, outputTokens: 0 } },
  ])
  assert.equal(summary.inputTokens, 2_000_000)
  assert.equal(summary.outputTokens, 1_000_000)
  assert.equal(summary.usd, 15) // free=0 + opus 1M input @ $15/M
})
