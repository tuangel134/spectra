import type { Task } from "../spec/types.js"

export type MultiAgentRunStatus =
  | "planned"
  | "running"
  | "integrating"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"

export type IsolatedTaskStatus =
  | "pending"
  | "blocked"
  | "allocating"
  | "running"
  | "reviewing"
  | "ready"
  | "integrating"
  | "integrated"
  | "failed"
  | "conflict"
  | "cancelled"
  | "interrupted"

export interface TaskLease {
  owner: string
  claims: string[]
  acquiredAt: number
  expiresAt: number
}

export interface IsolatedTaskRecord {
  id: number
  title: string
  description: string
  dependencies: number[]
  claimedFiles: string[]
  validation: string
  status: IsolatedTaskStatus
  branch?: string
  worktreePath?: string
  baseCommit?: string
  commit?: string
  actualFiles?: string[]
  unclaimedFiles?: string[]
  error?: string
  startedAt?: number
  finishedAt?: number
  integratedAt?: number
  lease?: TaskLease
}

export interface MultiAgentWave {
  number: number
  taskIds: number[]
}

export interface MultiAgentRun {
  id: string
  specId?: string
  title: string
  projectRoot: string
  baseCommit: string
  status: MultiAgentRunStatus
  waves: MultiAgentWave[]
  tasks: IsolatedTaskRecord[]
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
}

export interface IsolationPlan {
  waves: MultiAgentWave[]
  conflicts: Array<{ left: number; right: number; claims: string[] }>
  hasCycles: boolean
}

export interface TaskInspection {
  changedFiles: string[]
  unclaimedFiles: string[]
  clean: boolean
}

export interface VerificationResult {
  command: string
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
}

export interface TaskFinalizeResult {
  ok: boolean
  commit?: string
  inspection: TaskInspection
  verification?: VerificationResult
  error?: string
}

export interface TaskIntegrationResult {
  ok: boolean
  commit?: string
  conflictFiles?: string[]
  verification?: VerificationResult
  error?: string
}

export interface IsolatedAgentRunner {
  run(task: Task, worktreePath: string): Promise<{ success: boolean; error?: string }>
}
