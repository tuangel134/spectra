import { test } from "node:test"
import assert from "node:assert/strict"

import { SessionManager } from "../src/session/manager.ts"

test("create starts a session and sets it current", () => {
  const mgr = new SessionManager()
  const session = mgr.create("build", "opencode/claude-sonnet-4-6")
  assert.equal(mgr.current()?.id, session.id)
  assert.equal(session.agentId, "build")
})

test("addMessage appends to history and bumps updatedAt", () => {
  const mgr = new SessionManager()
  const session = mgr.create("build", "m")
  mgr.addMessage(session.id, { role: "user", content: "hello" })
  mgr.addMessage(session.id, { role: "assistant", content: "hi" })
  assert.equal(mgr.get(session.id)?.messages.length, 2)
})

test("addUsage accumulates token counts", () => {
  const mgr = new SessionManager()
  const session = mgr.create("build", "m")
  mgr.addUsage(session.id, 100, 50)
  mgr.addUsage(session.id, 20, 10)
  assert.deepEqual(mgr.get(session.id)?.usage, { inputTokens: 120, outputTokens: 60 })
})

test("snapshots can be created and popped for undo", () => {
  const mgr = new SessionManager()
  const session = mgr.create("build", "m")
  mgr.snapshot(session.id, [{ path: "a.ts", before: null, after: "x" }])
  const popped = mgr.popSnapshot(session.id)
  assert.equal(popped?.changes.length, 1)
  assert.equal(mgr.popSnapshot(session.id), null)
})

test("child sessions link to their parent", () => {
  const mgr = new SessionManager()
  const parent = mgr.create("build", "m")
  const child = mgr.createChild(parent.id, "review", "m")
  assert.equal(child.parentId, parent.id)
  assert.ok(mgr.get(parent.id)?.childIds.includes(child.id))
})

test("rewindTo with an unknown snapshot id is a no-op (never wipes the timeline)", () => {
  const mgr = new SessionManager()
  const session = mgr.create("build", "m")
  mgr.snapshot(session.id, [{ path: "a.ts", before: null, after: "1" }])
  mgr.snapshot(session.id, [{ path: "b.ts", before: null, after: "2" }])
  const removed = mgr.rewindTo(session.id, "does-not-exist")
  assert.equal(removed.length, 0, "unknown id must not remove anything")
  assert.equal(mgr.timeline(session.id).length, 2, "both snapshots must remain")
})

test("rewindTo without an id performs a full rewind", () => {
  const mgr = new SessionManager()
  const session = mgr.create("build", "m")
  mgr.snapshot(session.id, [{ path: "a.ts", before: null, after: "1" }])
  mgr.snapshot(session.id, [{ path: "b.ts", before: null, after: "2" }])
  const removed = mgr.rewindTo(session.id)
  assert.equal(removed.length, 2, "full rewind returns all snapshots")
  assert.equal(mgr.timeline(session.id).length, 0)
})

test("rewindTo a specific snapshot keeps it and removes only newer ones", () => {
  const mgr = new SessionManager()
  const session = mgr.create("build", "m")
  const first = mgr.snapshot(session.id, [{ path: "a.ts", before: null, after: "1" }])
  mgr.snapshot(session.id, [{ path: "b.ts", before: null, after: "2" }])
  mgr.snapshot(session.id, [{ path: "c.ts", before: null, after: "3" }])
  const removed = mgr.rewindTo(session.id, first.id)
  assert.equal(removed.length, 2, "the two newer snapshots are reverted")
  assert.equal(mgr.timeline(session.id).length, 1, "the target snapshot is kept")
})
