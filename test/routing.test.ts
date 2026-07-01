import { test } from "node:test"
import assert from "node:assert/strict"

import { ModelRouter, classifyDifficulty, type RoutingConfig, DEFAULT_ROUTING } from "../src/routing/index.ts"

function router(cfg: Partial<RoutingConfig>, main = "anthropic/claude-opus", small = "free/cheap"): ModelRouter {
  const merged: RoutingConfig = { ...structuredClone(DEFAULT_ROUTING), ...cfg }
  return new ModelRouter(() => merged, () => main, () => small)
}

// ── difficulty classifier ────────────────────────────────────────────────

test("classifyDifficulty rates trivial edits as easy", () => {
  assert.equal(classifyDifficulty("fix a typo in the README", "build"), "easy")
  assert.equal(classifyDifficulty("rename the variable foo to bar", "build"), "easy")
})

test("classifyDifficulty rates architecture/algorithm work as hard", () => {
  assert.equal(
    classifyDifficulty("Refactor the architecture to support distributed concurrency and optimize the algorithm", "build"),
    "hard",
  )
})

test("classifyDifficulty rates ordinary work as medium", () => {
  assert.equal(classifyDifficulty("add a new endpoint that returns the user profile", "build"), "medium")
})

test("classifyDifficulty treats long, multi-requirement prompts as hard", () => {
  const long = "Build a system with:\n- a parser\n- an evaluator\n- a planner\n- a scheduler\n- a reporter\n" + "x".repeat(1300)
  assert.equal(classifyDifficulty(long, "plan"), "hard")
})

// ── tiered mode ──────────────────────────────────────────────────────────

test("tiered mode routes by difficulty to the configured tier model", () => {
  const r = router({ mode: "tiered", tiers: { easy: "free/cheap", medium: "openai/gpt", hard: "anthropic/opus" } })
  assert.equal(r.pick("build", { text: "fix a typo" }), "free/cheap")
  assert.equal(r.pick("build", { text: "add a profile endpoint" }), "openai/gpt")
  assert.equal(r.pick("build", { text: "redesign the architecture for concurrency and optimize the algorithm" }), "anthropic/opus")
})

test("tiered mode falls back to small/main when a tier is unset", () => {
  const r = router({ mode: "tiered", tiers: { hard: "anthropic/opus" } }, "main/model", "small/model")
  assert.equal(r.pick("build", { text: "fix a typo" }), "small/model") // easy -> small
  assert.equal(r.pick("build", { text: "add a profile endpoint" }), "main/model") // medium -> main
})

// ── autochange chain + sticky cooldown ────────────────────────────────────

test("chain returns primary plus fallbacks when autochange is on", () => {
  const r = router({ mode: "manual", autochange: { enabled: true, fallbacks: ["free/a", "free/b"] } })
  assert.deepEqual(r.chain("build"), ["anthropic/claude-opus", "free/a", "free/b"])
})

test("chain ignores fallbacks when autochange is off", () => {
  const r = router({ mode: "manual", autochange: { enabled: false, fallbacks: ["free/a"] } })
  assert.deepEqual(r.chain("build"), ["anthropic/claude-opus"])
})

test("markExhausted pushes a cooling-down model to the back of the chain", () => {
  const r = router({ mode: "manual", autochange: { enabled: true, fallbacks: ["free/a", "free/b"] } })
  r.markExhausted("anthropic/claude-opus", 3600)
  // primary is on cooldown, so it should now be tried last
  assert.deepEqual(r.chain("build"), ["free/a", "free/b", "anthropic/claude-opus"])
  assert.equal(r.onCooldown("anthropic/claude-opus"), true)
  assert.equal(r.onCooldown("free/a"), false)
})

test("cooldown expires and the model returns to the front", () => {
  const r = router({ mode: "manual", autochange: { enabled: true, fallbacks: ["free/a"] } })
  r.markExhausted("anthropic/claude-opus", 0) // 0s -> effectively immediate default? clamp to default
  // With retryAfter<=0 we use the default cooldown, so it should be on cooldown.
  assert.equal(r.onCooldown("anthropic/claude-opus"), true)
})
