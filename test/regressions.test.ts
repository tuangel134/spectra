import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { addRegressions, loadRegressions, regressionCases } from "../src/eval/regressions.ts"

function withDir(fn: (dir: string) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "spectra-reg-"))
    try {
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test("addRegressions persists and de-duplicates commands", withDir((dir) => {
  addRegressions(dir, ["true", "true", "echo hi"])
  const cases = loadRegressions(dir)
  assert.equal(cases.length, 2) // 'true' de-duped
}))

test("regressionCases run commands and report pass/fail", withDir(async (dir) => {
  addRegressions(dir, ["true", "false"])
  const cases = regressionCases(dir)
  const results = await Promise.all(cases.map((c) => c()))
  const byPass = results.map((r) => r.pass).sort()
  assert.deepEqual(byPass, [false, true])
}))
