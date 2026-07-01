/**
 * Anti-stall detection.
 *
 * A long autonomous run can get stuck: repeating the same failing fix, making
 * no file changes, or looping on an identical error. We summarize each
 * iteration into a compact "progress signature" and watch for it repeating. If
 * the signature does not change for `threshold` iterations, the run is
 * considered stalled and the orchestrator switches strategy (research, escalate
 * the prompt, or move on after recording the blocker).
 */

import { createHash } from "node:crypto"

export interface ProgressInputs {
  /** Index of the phase being worked on. */
  phase: number
  /** Completed phase count. */
  phasesCompleted: number
  /** Signature of the most recent verification failure (empty if passing). */
  lastErrorDigest: string
}

/** Build a stable signature from the inputs that matter for progress. */
export function progressSignature(inputs: ProgressInputs): string {
  // NOTE: deliberately does NOT include a monotonic run-total file counter.
  // A fix pass almost always touches a file, so folding that in would make the
  // signature change every pass and the stall detector would never trip. Real
  // progress is: advancing phases or changing which error we're stuck on.
  const raw = `${inputs.phase}|${inputs.phasesCompleted}|${inputs.lastErrorDigest}`
  return createHash("sha1").update(raw).digest("hex").slice(0, 16)
}

/** Compress an error message to a digest so cosmetic differences don't reset stall counting. */
export function errorDigest(error: string | undefined): string {
  if (!error) return ""
  const normalized = error
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, "")
    .replace(/\d+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400)
  return createHash("sha1").update(normalized).digest("hex").slice(0, 12)
}

export interface StallVerdict {
  /** True once the same signature has repeated `threshold` times. */
  stalled: boolean
  /** Current consecutive-no-progress count. */
  count: number
  /** The signature that was recorded. */
  signature: string
}

/**
 * Tracks progress signatures across iterations.
 * Pure and serializable: callers persist `count` + `last` in the run state.
 */
export class StallDetector {
  constructor(
    private readonly threshold: number,
    private last: string | undefined = undefined,
    private count = 0,
  ) {}

  /** Record a new signature, returning whether we are now stalled. */
  record(signature: string): StallVerdict {
    if (signature === this.last) {
      this.count++
    } else {
      this.last = signature
      this.count = 0
    }
    return { stalled: this.count >= this.threshold, count: this.count, signature }
  }

  reset(): void {
    this.count = 0
    this.last = undefined
  }

  get state(): { last: string | undefined; count: number } {
    return { last: this.last, count: this.count }
  }
}
