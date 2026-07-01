import { test } from "node:test"
import assert from "node:assert/strict"

import { getFreeModels } from "../src/provider/free-models.ts"
import { FREE_MODELS } from "../src/provider/zen.ts"

test("getFreeModels returns a non-empty list (cache or bundled fallback)", () => {
  const models = getFreeModels()
  assert.ok(Array.isArray(models))
  assert.ok(models.length > 0)
  // Every entry has the required shape.
  for (const m of models) {
    assert.equal(typeof m.id, "string")
    assert.equal(typeof m.name, "string")
    assert.equal(typeof m.context, "number")
  }
})

test("every bundled free model id carries the -free suffix", () => {
  for (const m of FREE_MODELS) {
    assert.match(m.id, /-free$/, `${m.id} should end in -free`)
  }
})
