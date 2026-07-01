import { test } from "node:test"
import assert from "node:assert/strict"

import { matchGlob, matchWildcard } from "../src/util/glob.ts"

test("matchGlob handles single star within a path segment", () => {
  assert.equal(matchGlob("src/index.ts", "src/*.ts"), true)
  assert.equal(matchGlob("src/sub/index.ts", "src/*.ts"), false)
})

test("matchGlob handles double star across segments", () => {
  assert.equal(matchGlob("src/sub/deep/index.ts", "src/**/*.ts"), true)
  assert.equal(matchGlob("index.ts", "**/*.ts"), true)
})

test("matchGlob matches extension globs", () => {
  assert.equal(matchGlob("file.tsx", "*.tsx"), true)
  assert.equal(matchGlob("file.ts", "*.tsx"), false)
})

test("matchWildcard handles command patterns", () => {
  assert.equal(matchWildcard("git push origin", "git push*"), true)
  assert.equal(matchWildcard("git status", "git push*"), false)
  assert.equal(matchWildcard("anything", "*"), true)
})
