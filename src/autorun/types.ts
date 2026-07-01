/**
 * Long-Running / Full-Stack autonomous mode — shared types.
 *
 * In this mode Spectra plans a complete project as a spec, splits it into
 * phases, and executes them one by one — verifying, bug-hunting, and fixing
 * after every phase — until the whole project is delivered with no errors and
 * no skeleton/stub code. It is built to run unattended for hours: a watchdog
 * resumes it if the process stalls or crashes, and an anti-stall detector
 * changes strategy when it stops making progress.
 */

export type AutorunStatus =
  | "idle"
  | "planning"
  | "executing"
  | "verifying"
  | "fixing"
  | "researching"
  | "completed"
  | "failed"
  | "stalled"
  | "paused"

export type PhaseStatus = "pending" | "in_progress" | "verifying" | "fixing" | "completed" | "failed"

export interface AutorunPhase {
  index: number
  title: string
  /** Spec task ids that make up this phase. */
  taskIds: number[]
  status: PhaseStatus
  /** Number of bug-review passes performed after the phase's work. */
  reviewPasses: number
  startedAt?: number
  completedAt?: number
}

export type EventLevel =
  | "info"
  | "phase"
  | "verify"
  | "fix"
  | "research"
  | "warn"
  | "error"
  | "success"

export interface AutorunEvent {
  ts: number
  level: EventLevel
  message: string
}

export interface AutorunState {
  id: string
  goal: string
  specId?: string
  status: AutorunStatus
  phases: AutorunPhase[]
  /** Index of the phase currently being worked on. */
  currentPhase: number
  createdAt: number
  updatedAt: number
  /** Last time the orchestrator reported it was alive (watchdog input). */
  heartbeatAt: number
  /** Total recovery/resume attempts triggered by the watchdog. */
  recoveries: number
  /** Consecutive iterations with no detectable progress (anti-stall). */
  stallCount: number
  /** Total phase fix/verify attempts across the whole run (persisted so the
   *  attempts ceiling survives crash/resume instead of resetting to 0). */
  totalAttempts?: number
  /** Total file changes observed across the run (persisted for resume). */
  filesChanged?: number
  /** Completeness/polish reviews run at the final gate (persisted for resume). */
  polishReviews?: number
  /** Opaque signature of the last observed progress state. */
  progressSignature?: string
  events: AutorunEvent[]
  lastError?: string
  finished: boolean
}

export interface AutorunConfig {
  /** Master switch (the feature exists regardless; this gates auto-resume). */
  enabled?: boolean
  /** Bug-review + fix passes after each phase before it may be marked done. */
  reviewPasses?: number
  /** Max fix attempts on a single failing phase before researching/escalating. */
  maxFixAttempts?: number
  /** Consecutive no-progress iterations that count as a stall. */
  stallThreshold?: number
  /** Watchdog: ms without a heartbeat before the run is considered stalled. */
  heartbeatStaleMs?: number
  /** Hard ceiling on total phase attempts to avoid pathological infinite loops. */
  maxTotalAttempts?: number
  /** Explicit verification commands; auto-detected from package.json if empty. */
  verifyCommands?: string[]
  /** Swarm: run independent tasks within a phase as parallel subagents. */
  parallel?: boolean
  /** Max concurrent subagents when parallel is on. */
  maxParallel?: number
  /** Optional URL of the running app; enables screenshot+vision verification. */
  previewUrl?: string
}

export const DEFAULT_AUTORUN_CONFIG: Required<AutorunConfig> = {
  enabled: true,
  reviewPasses: 3,
  maxFixAttempts: 5,
  stallThreshold: 3,
  heartbeatStaleMs: 180_000,
  maxTotalAttempts: 200,
  verifyCommands: [],
  parallel: true,
  maxParallel: 8,
  previewUrl: "",
}
