import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { coreProjectKey, isProcessAlive } from "../src/core/lease.js"

test("core project keys are stable and do not expose the project path", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-core-key-"))
  try {
    const first = coreProjectKey(root)
    const second = coreProjectKey(root)
    assert.equal(first, second)
    assert.match(first, /^[a-f0-9]{24}$/)
    assert.equal(first.includes(root), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("isProcessAlive recognizes the current process", () => {
  assert.equal(isProcessAlive(process.pid), true)
  assert.equal(isProcessAlive(-1), false)
})
