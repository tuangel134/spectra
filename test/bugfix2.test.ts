import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseTasks, serializeTasks } from "../src/spec/parser.ts"
import { SpecEngine } from "../src/spec/engine.ts"
import { progressSignature, StallDetector } from "../src/autorun/stall.ts"
import { applyUndo } from "../src/workflow/undo.ts"
import { SessionManager } from "../src/session/manager.ts"

// ── spec parser: description round-trip (was silently erased on every status
//    change because serializeTasks never emitted task.description) ───────────
test("serializeTasks preserves the task description on a parse round-trip", () => {
  const md = [
    "# Tasks: Demo",
    "",
    "## Execution Plan",
    "",
    "- [ ] Task 1: Build the thing",
    "  This is an important design note that must survive.",
    "  - Dependencies: []",
    "  - Files: [src/a.ts]",
    "  - Validation: npm test",
    "",
  ].join("\n")

  const tasks = parseTasks(md)
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0]!.description, "This is an important design note that must survive.")

  // Re-serialize (as the engine does on every status update) and re-parse.
  const roundTripped = parseTasks(serializeTasks("Demo", tasks))
  assert.equal(
    roundTripped[0]!.description,
    "This is an important design note that must survive.",
    "description must not be lost when tasks.md is rewritten",
  )
  assert.equal(roundTripped[0]!.title, "Build the thing")
  assert.deepEqual(roundTripped[0]!.files, ["src/a.ts"])
})

// ── spec engine: path traversal guard on unsanitized spec ids ───────────────
test("SpecEngine.specDir rejects ids that escape the base directory", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-spec-"))
  try {
    const engine = new SpecEngine({ projectRoot: root, outputDir: ".spectra/specs", maxParallelTasks: 4 })
    assert.throws(() => engine.specDir("../../etc"), /Invalid spec id/)
    assert.throws(() => engine.specDir("/etc/passwd"), /Invalid spec id/)
    assert.throws(() => engine.specDir(".."), /Invalid spec id/)
    // A normal id resolves fine.
    assert.ok(engine.specDir("my-spec-abc").endsWith(join(".spectra", "specs", "my-spec-abc")))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ── anti-stall: signature must NOT fold in a monotonic file counter, else it
//    changes every pass and the stall detector never trips ────────────────────
test("progressSignature is stable across passes with the same phase + error", () => {
  const a = progressSignature({ phase: 2, phasesCompleted: 1, lastErrorDigest: "abc" })
  const b = progressSignature({ phase: 2, phasesCompleted: 1, lastErrorDigest: "abc" })
  assert.equal(a, b, "same progress state must produce the same signature")

  const c = progressSignature({ phase: 2, phasesCompleted: 1, lastErrorDigest: "different" })
  assert.notEqual(a, c, "a new error must change the signature")
})

test("StallDetector trips after the threshold when the same failure repeats", () => {
  const det = new StallDetector(3)
  const sig = progressSignature({ phase: 0, phasesCompleted: 0, lastErrorDigest: "boom" })
  assert.equal(det.record(sig).stalled, false) // count 0
  assert.equal(det.record(sig).stalled, false) // count 1
  assert.equal(det.record(sig).stalled, false) // count 2
  assert.equal(det.record(sig).stalled, true) // count 3 -> stalled
})

// ── undo: must never write/delete outside the project root ───────────────────
test("applyUndo skips changes whose path escapes the project root", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-undo-"))
  const outside = mkdtempSync(join(tmpdir(), "spectra-outside-"))
  const escapeTarget = join(outside, "victim.txt")
  try {
    writeFileSync(escapeTarget, "original")
    // A malicious snapshot tries to overwrite a file outside the root.
    const snap = {
      id: "snap_x",
      messageIndex: 0,
      timestamp: Date.now(),
      changes: [{ path: escapeTarget, before: "HACKED", after: "" }],
    }
    const reverted = applyUndo(root, snap as never)
    assert.equal(reverted, 0, "no out-of-root change should be applied")
    assert.equal(readFileSync(escapeTarget, "utf-8"), "original", "outside file must be untouched")
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test("applyUndo restores an in-root file atomically", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-undo2-"))
  try {
    const rel = "src/file.ts"
    writeFileSync(join(root, "changed.txt"), "new")
    const snap = {
      id: "snap_y",
      messageIndex: 0,
      timestamp: Date.now(),
      changes: [{ path: rel, before: "old contents", after: "new contents" }],
    }
    const reverted = applyUndo(root, snap as never)
    assert.equal(reverted, 1)
    assert.equal(readFileSync(join(root, rel), "utf-8"), "old contents")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ── session manager: ephemeral sessions are evicted (no unbounded leak) ──────
test("SessionManager evicts old ephemeral sessions beyond the cap", () => {
  const mgr = new SessionManager()
  // Keep one real (current) session that must never be evicted.
  const keep = mgr.create("build", "test/model", undefined, true)
  // Create many ephemeral (isolated) sessions.
  for (let i = 0; i < 250; i++) mgr.create("build", "test/model", undefined, false)
  const total = mgr.list().length
  assert.ok(total <= 101 + 1, `ephemeral sessions should be capped, got ${total}`)
  assert.ok(mgr.get(keep.id), "the current session must never be evicted")
})

// ── session manager: snapshots per session are bounded ──────────────────────
test("SessionManager bounds retained snapshots per session", () => {
  const mgr = new SessionManager()
  const s = mgr.create("build", "test/model")
  for (let i = 0; i < 300; i++) mgr.snapshot(s.id, [])
  assert.ok(mgr.timeline(s.id).length <= 200, "snapshot history must be capped")
})
