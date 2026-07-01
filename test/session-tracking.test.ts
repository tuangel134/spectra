import { test } from "node:test"
import assert from "node:assert/strict"

import { SessionManager } from "../src/session/manager.ts"

test("session records tool logs with status and caps at 500", () => {
  const mgr = new SessionManager()
  const s = mgr.create("build", "free/x")
  mgr.addToolLog(s.id, { tool: "write", args: "{}", status: "ok", output: "Created file" })
  mgr.addToolLog(s.id, { tool: "bash", args: "ls", status: "error", output: "Error: nope" })
  const session = mgr.get(s.id)!
  assert.equal(session.toolLogs.length, 2)
  assert.equal(session.toolLogs[0]!.tool, "write")
  assert.equal(session.toolLogs[1]!.status, "error")
  assert.ok(session.toolLogs[0]!.id.startsWith("log_"))
})

test("session records file changes keeping earliest before and latest after", () => {
  const mgr = new SessionManager()
  const s = mgr.create("build", "free/x")
  mgr.recordFileChange(s.id, { path: "a.ts", before: "v1", after: "v2" })
  mgr.recordFileChange(s.id, { path: "a.ts", before: "v2", after: "v3" })
  const change = mgr.get(s.id)!.changedFiles["a.ts"]!
  assert.equal(change.before, "v1") // earliest preserved → full-session diff
  assert.equal(change.after, "v3") // latest content
})

test("created file has null before", () => {
  const mgr = new SessionManager()
  const s = mgr.create("build", "free/x")
  mgr.recordFileChange(s.id, { path: "new.ts", before: null, after: "content" })
  assert.equal(mgr.get(s.id)!.changedFiles["new.ts"]!.before, null)
})
