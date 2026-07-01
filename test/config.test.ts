import { test } from "node:test"
import assert from "node:assert/strict"

import { stripJsonComments, parseJsonc, deepMerge } from "../src/config/loader.ts"

test("stripJsonComments removes line and block comments", () => {
  const input = `{
    // line comment
    "a": 1, /* block */ "b": 2
  }`
  const result = parseJsonc(input) as { a: number; b: number }
  assert.equal(result.a, 1)
  assert.equal(result.b, 2)
})

test("stripJsonComments preserves comment-like content inside strings", () => {
  const input = `{ "url": "https://example.com/path" }`
  const stripped = stripJsonComments(input)
  assert.ok(stripped.includes("https://example.com/path"))
})

test("parseJsonc handles trailing commas", () => {
  const input = `{ "list": [1, 2, 3,], "obj": { "x": 1, }, }`
  const result = parseJsonc(input) as { list: number[]; obj: { x: number } }
  assert.deepEqual(result.list, [1, 2, 3])
  assert.equal(result.obj.x, 1)
})

test("deepMerge combines nested objects", () => {
  const base = { a: 1, nested: { x: 1, y: 2 }, list: [1] }
  const override = { b: 2, nested: { y: 3, z: 4 } }
  const merged = deepMerge(base, override as Partial<typeof base>)
  assert.equal(merged.a, 1)
  assert.deepEqual(merged.nested, { x: 1, y: 3, z: 4 })
})

test("deepMerge replaces arrays rather than merging them", () => {
  const base = { list: [1, 2, 3] }
  const override = { list: [9] }
  const merged = deepMerge(base, override)
  assert.deepEqual(merged.list, [9])
})
