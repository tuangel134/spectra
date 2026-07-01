import { test } from "node:test"
import assert from "node:assert/strict"

import { SessionManager } from "../src/session/manager.ts"

test("isolated sessions (makeCurrent=false) do not hijack the active chat session", () => {
  const sm = new SessionManager()
  const chat = sm.create("build", "m") // the user's chat session → becomes current
  assert.equal(sm.current()?.id, chat.id)

  // A spec/subagent/autorun session must NOT steal "current".
  const sub = sm.create("spec", "m", undefined, false)
  assert.notEqual(sub.id, chat.id)
  assert.equal(sm.current()?.id, chat.id, "current must still be the chat session after an isolated create")

  // Even several isolated sessions leave the chat session active.
  sm.create("spec", "m", undefined, false)
  sm.create("explore", "m", undefined, false)
  assert.equal(sm.current()?.id, chat.id)
})

test("setCurrent re-activates an existing session and rejects unknown ids", () => {
  const sm = new SessionManager()
  const a = sm.create("build", "m")
  const b = sm.create("build", "m", undefined, false)
  assert.equal(sm.current()?.id, a.id)
  assert.equal(sm.setCurrent(b.id), true)
  assert.equal(sm.current()?.id, b.id)
  assert.equal(sm.setCurrent("does-not-exist"), false)
  assert.equal(sm.current()?.id, b.id)
})
