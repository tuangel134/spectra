import test from "node:test"
import assert from "node:assert/strict"
import { claimsAllowFile, claimsOverlap, normalizeClaim } from "../src/multiagent/paths.js"

test("file claims understand directories and globs", () => {
  assert.equal(claimsAllowFile(["src/api"], "src/api/routes.ts"), true)
  assert.equal(claimsAllowFile(["test/**/*.test.ts"], "test/unit/a.test.ts"), true)
  assert.equal(claimsAllowFile(["src/api"], "src/ui/app.ts"), false)
})

test("claim overlap catches parent directories and wildcard ownership", () => {
  assert.equal(claimsOverlap("src", "src/app.ts"), true)
  assert.equal(claimsOverlap("src/**/*.ts", "src/api/routes.ts"), true)
  assert.equal(claimsOverlap("src/api", "test/api"), false)
})

test("claim normalization rejects traversal and absolute paths", () => {
  assert.throws(() => normalizeClaim("../secret"))
  assert.throws(() => normalizeClaim("/etc/passwd"))
})
