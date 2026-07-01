/**
 * Autorun manager — public surface for the Long-Running / Full-Stack mode.
 *
 * Owns the single active Autopilot for a runtime and exposes start / resume /
 * cancel / status, plus read access to persisted runs (for the UI and for
 * crash recovery on the next launch).
 */

import type { Runtime } from "../runtime.js"
import { Autopilot } from "./orchestrator.js"
import { AutorunStore } from "./state.js"
import type { AutorunConfig, AutorunState } from "./types.js"

export * from "./types.js"
export { Autopilot } from "./orchestrator.js"
export { AutorunStore } from "./state.js"
export {
  detectVerifyCommands,
  scanForSkeletons,
  collectSourceFiles,
  runVerification,
  runCommand,
} from "./verify.js"
export { StallDetector, progressSignature, errorDigest } from "./stall.js"
export { Watchdog } from "./watchdog.js"

export class AutorunManager {
  private readonly store: AutorunStore
  private pilot: Autopilot | null = null

  constructor(
    private readonly rt: Runtime,
    private readonly config: AutorunConfig = {},
  ) {
    this.store = new AutorunStore(rt.config.projectRoot)
  }

  get running(): boolean {
    return this.pilot?.isRunning ?? false
  }

  /** Begin a new autonomous run (fire-and-forget; poll status for progress). */
  start(goal: string): AutorunState {
    if (this.running) throw new Error("An autorun is already in progress.")
    this.pilot = new Autopilot({ rt: this.rt, config: this.config })
    const state = this.pilot.current ?? this.store.create(goal)
    // Kick off asynchronously; the caller polls /api/autorun for updates.
    void this.pilot.start(goal).catch(() => {})
    return this.pilot.current ?? state
  }

  /** Resume the latest unfinished run (used on launch / after a crash). */
  resume(id?: string): AutorunState | null {
    const target = id ? this.store.load(id) : this.store.latestResumable()
    if (!target) return null
    this.pilot = new Autopilot({ rt: this.rt, config: this.config })
    void this.pilot.resume(id).catch(() => {})
    return target
  }

  /** Request a graceful pause. */
  cancel(): void {
    this.pilot?.cancel()
  }

  /** Current live state, falling back to the latest persisted run. */
  status(): AutorunState | null {
    return this.pilot?.current ?? this.store.list()[0] ?? null
  }

  list(): AutorunState[] {
    return this.store.list()
  }

  /** Whether a crashed/unfinished run is available to resume. */
  hasResumable(): boolean {
    return this.store.latestResumable() !== null
  }
}
