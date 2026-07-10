#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { CoreStateStore } from "../dist/core/state-store.js"
import { FileLockManager } from "../dist/multiagent/locks.js"
import { CrashRecoveryJournal } from "../dist/production/crash-recovery.js"

const root = await mkdtemp(join(tmpdir(), "spectra-stress-"))
try {
  const started = performance.now()
  const store = new CoreStateStore(root, { forceJsonl: true })
  for (let index = 0; index < 5000; index++) store.record("stress.event", { index }, `run-${index % 20}`)
  if (store.recent(1000).length !== 1000) throw new Error("Core journal lost events")
  for (let index = 0; index < 500; index++) store.heartbeatClient(`client-${index}`)
  if (store.activeClientCount() !== 500) throw new Error("Core client registry lost heartbeats")
  store.close()
  const locks = new FileLockManager(root)
  for (let index = 0; index < 250; index++) locks.acquire(`agent-${index}`, [`src/area-${index}/**`], 60_000)
  if (locks.list().length !== 250) throw new Error("File lock registry lost leases")
  for (let index = 0; index < 250; index++) locks.release(`agent-${index}`)
  const recovery = new CrashRecoveryJournal(root, "1.0.0", join(root, "recovery")); recovery.begin("stress", 99999999)
  if (!recovery.interrupted()) throw new Error("Crash recovery stress marker missing")
  recovery.acknowledge()
  const elapsed = Math.round(performance.now() - started)
  if (elapsed > 12_000) throw new Error(`Stress budget exceeded: ${elapsed}ms`)
  console.log(`Spectra stress suite passed in ${elapsed}ms.`)
} finally { await rm(root, { recursive: true, force: true }) }
