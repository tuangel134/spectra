import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SessionManager } from "../src/session/manager.ts"

test("a chat session persists and is resumable after a 'restart'", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-resume-"))
  try {
    // Session 1: the user works, then "quits" (flush forces the debounced write).
    const sm1 = new SessionManager()
    sm1.enablePersistence(dir)
    const chat = sm1.create("build", "m")
    sm1.addMessage(chat.id, { role: "user", content: "build me a todo app" })
    sm1.addMessage(chat.id, { role: "assistant", content: "Here's the plan…" })
    sm1.flush()

    // Session 2: a fresh process opens the same project.
    const sm2 = new SessionManager()
    sm2.enablePersistence(dir)
    const resumed = sm2.resumable()
    assert.ok(resumed, "the prior session should be resumable")
    assert.equal(resumed!.id, chat.id)
    assert.equal(resumed!.messages.length, 2, "the full context is restored")
    assert.equal(sm2.current()?.id, chat.id, "the latest session becomes current on load")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("ephemeral (isolated) sessions are never written to disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-eph-"))
  try {
    const sm = new SessionManager()
    sm.enablePersistence(dir)
    const chat = sm.create("build", "m")
    const sub = sm.create("spec", "m", undefined, false) // ephemeral
    sm.addMessage(sub.id, { role: "user", content: "spec internals" })
    sm.addMessage(chat.id, { role: "user", content: "hi" })
    sm.flush()

    const files = readdirSync(join(dir, ".spectra", "sessions"))
    assert.ok(files.includes(`${chat.id}.json`), "chat session is persisted")
    assert.ok(!files.includes(`${sub.id}.json`), "ephemeral session is NOT persisted")
    // And it is excluded from resume.
    assert.equal(sm.resumable()?.id, chat.id)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("resumable returns null on a brand-new project", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-new-"))
  try {
    const sm = new SessionManager()
    sm.enablePersistence(dir)
    assert.equal(sm.resumable(), null)
    // An empty session (no messages) is not resumable either.
    sm.create("build", "m")
    assert.equal(sm.resumable(), null)
    assert.ok(existsSync(join(dir, ".spectra", "sessions")))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("compaction's setMessages persists immediately", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-compact-"))
  try {
    const sm = new SessionManager()
    sm.enablePersistence(dir)
    const chat = sm.create("build", "m")
    sm.addMessage(chat.id, { role: "user", content: "a" })
    sm.flush()
    // Simulate compaction replacing the transcript.
    sm.setMessages(chat.id, [{ role: "system", content: "[compacted summary]" }])

    const sm2 = new SessionManager()
    sm2.enablePersistence(dir)
    const resumed = sm2.resumable()
    assert.ok(resumed)
    assert.equal(resumed!.messages.length, 1)
    assert.match(resumed!.messages[0]!.content, /compacted summary/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
