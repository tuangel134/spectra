import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { FileLockManager } from "../src/multiagent/locks.js"

test("file locks reject overlapping owners and allow disjoint claims", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-locks-"))
  const locks = new FileLockManager(root)
  try {
    locks.acquire("run:1", ["src/api"])
    assert.throws(() => locks.acquire("run:2", ["src/api/routes.ts"]), /locked by run:1/)
    assert.doesNotThrow(() => locks.acquire("run:3", ["test"]));
    assert.equal(locks.release("run:1"), true)
    assert.doesNotThrow(() => locks.acquire("run:2", ["src/api/routes.ts"]))
  } finally {
    rmSync(dirname(locks.statePath), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test("expired file locks are discarded", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-lock-expiry-"))
  const locks = new FileLockManager(root)
  try {
    locks.acquire("old", ["src"], 5_000, 100)
    assert.equal(locks.list(6_000).length, 0)
  } finally {
    rmSync(dirname(locks.statePath), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})
