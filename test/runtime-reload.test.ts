import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SessionManager } from "../src/session/manager.ts"
import { createRuntime, reloadRuntime } from "../src/runtime.ts"

/** Seed a project dir with a marker config + a persisted session. */
function seedProject(dir: string, text: string): string {
  // A spectra.jsonc marker pins findProjectRoot to this dir.
  writeFileSync(join(dir, "spectra.jsonc"), "{}")
  const sm = new SessionManager()
  sm.enablePersistence(dir)
  const s = sm.create("build", "free/deepseek-v4-flash-free")
  sm.addMessage(s.id, { role: "user", content: text })
  sm.addMessage(s.id, { role: "assistant", content: "ack " + text })
  sm.flush()
  return s.id
}

test("reloadRuntime switches projects in place and resumes each project's session", () => {
  const A = mkdtempSync(join(tmpdir(), "spectra-rtA-"))
  const B = mkdtempSync(join(tmpdir(), "spectra-rtB-"))
  try {
    const idA = seedProject(A, "alpha work")
    const idB = seedProject(B, "beta work")

    // Launch in A.
    const rt = createRuntime({ cwd: A })
    assert.equal(rt.config.projectRoot, A)
    assert.equal(rt.sessions.resumable()?.id, idA)
    assert.match(rt.sessions.resumable()!.messages[0]!.content, /alpha/)

    // Switch to B (same rt object, new project + its session).
    reloadRuntime(rt, { cwd: B })
    assert.equal(rt.config.projectRoot, B)
    assert.equal(rt.sessions.resumable()?.id, idB)
    assert.match(rt.sessions.resumable()!.messages[0]!.content, /beta/)

    // Back to A — its session is still there.
    reloadRuntime(rt, { cwd: A })
    assert.equal(rt.config.projectRoot, A)
    assert.equal(rt.sessions.resumable()?.id, idA)
  } finally {
    rmSync(A, { recursive: true, force: true })
    rmSync(B, { recursive: true, force: true })
  }
})

test("behavioral settings are per-project: project A's routing does not leak to B", async () => {
  const { saveRouting } = await import("../src/config/writer.ts")
  const A = mkdtempSync(join(tmpdir(), "spectra-setA-"))
  const B = mkdtempSync(join(tmpdir(), "spectra-setB-"))
  try {
    seedProject(A, "a")
    seedProject(B, "b")

    const rt = createRuntime({ cwd: A })
    assert.equal(rt.config.config.routing.mode, "manual", "default routing")

    // Save tiered routing to project A only.
    saveRouting({ mode: "tiered" }, A)

    // Switch to B → B keeps its own default (no leak).
    reloadRuntime(rt, { cwd: B })
    assert.equal(rt.config.config.routing.mode, "manual", "B must not inherit A's routing")

    // Back to A → A's per-project routing is loaded.
    reloadRuntime(rt, { cwd: A })
    assert.equal(rt.config.config.routing.mode, "tiered", "A's per-project routing persists")
  } finally {
    rmSync(A, { recursive: true, force: true })
    rmSync(B, { recursive: true, force: true })
  }
})
