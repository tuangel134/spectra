import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CrashRecoveryJournal, projectRecoveryKey } from "../src/production/crash-recovery.ts"

test("crash journal detects a stale unclean process and can acknowledge it", async () => {
  const root = await mkdtemp(join(tmpdir(), "spectra-recovery-")); const project = join(root, "project")
  try {
    const live = new CrashRecoveryJournal(project, "1.0.0", join(root, "live")); live.begin("current")
    assert.equal(live.interrupted(), null)
    const journal = new CrashRecoveryJournal(project, "1.0.0", join(root, "state")); journal.begin("old", 99999999)
    assert.equal(journal.interrupted()?.instanceId, "old"); assert.equal(journal.acknowledge(), true); assert.equal(journal.interrupted(), null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("project recovery keys do not reveal absolute paths", () => {
  const key = projectRecoveryKey("/home/user/private-project")
  assert.match(key, /^[a-f0-9]{24}$/); assert.doesNotMatch(key, /home|private|project/)
})
