import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CoreStateStore } from "../src/core/state-store.js"

test("CoreStateStore persists events, metadata, clients, and recovery in JSONL fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-core-state-"))
  let now = 1_000
  try {
    const store = new CoreStateStore(root, { forceJsonl: true, now: () => now })
    assert.equal(store.backend, "jsonl")
    store.setMeta("instance", "abc")
    assert.equal(store.getMeta("instance"), "abc")
    store.record("run.started", { goal: "ship" }, "run_1")
    now += 1_000
    store.heartbeatClient("desktop")
    assert.equal(store.activeClientCount(), 1)
    const recovery = store.recoverySummary(false)
    assert.equal(recovery.interrupted, true)
    assert.equal(recovery.latestRunId, "run_1")
    store.record("run.completed", {}, "run_1")
    assert.equal(store.recoverySummary(false).interrupted, false)
    store.close()

    const reopened = new CoreStateStore(root, { forceJsonl: true, now: () => now })
    assert.equal(reopened.getMeta("instance"), "abc")
    assert.equal(reopened.recent(10)[0]?.type, "run.completed")
    reopened.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("CoreStateStore selects SQLite WAL when available and otherwise stays compatible", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-core-backend-"))
  try {
    const store = new CoreStateStore(root)
    assert.match(store.backend, /^(sqlite|jsonl)$/)
    store.record("core.ready", { backend: store.backend })
    assert.equal(store.recent(1)[0]?.type, "core.ready")
    store.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
