import { existsSync } from "node:fs"
import type { Task } from "../spec/types.js"
import { currentCommit, GitWorktreeManager, isWorkingTreeClean } from "./git.js"
import { FileLockManager } from "./locks.js"
import { normalizeClaims } from "./paths.js"
import { finalizeTask, integrateTask } from "./review.js"
import { planIsolatedTasks } from "./scheduler.js"
import { MultiAgentStore } from "./store.js"
import type {
  IsolationPlan,
  IsolatedAgentRunner,
  IsolatedTaskRecord,
  MultiAgentRun,
  TaskFinalizeResult,
  TaskIntegrationResult,
} from "./types.js"

function runId(): string {
  return `ma_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function owner(id: string, taskId: number): string {
  return `${id}:task:${taskId}`
}

export class MultiAgentCoordinator {
  readonly locks: FileLockManager
  readonly store: MultiAgentStore
  private worktreeManager?: GitWorktreeManager

  constructor(readonly projectRoot: string, readonly maxParallel = 4) {
    this.locks = new FileLockManager(projectRoot)
    this.store = new MultiAgentStore(projectRoot)
    this.recover()
  }

  get worktrees(): GitWorktreeManager {
    this.worktreeManager ??= new GitWorktreeManager(this.projectRoot)
    return this.worktreeManager
  }

  plan(tasks: Task[]): IsolationPlan {
    return planIsolatedTasks(tasks, this.maxParallel)
  }

  create(title: string, tasks: Task[], specId?: string): MultiAgentRun {
    if (!isWorkingTreeClean(this.projectRoot)) {
      throw new Error("Start multi-agent runs from a clean Git workspace. Commit or stash current changes first.")
    }
    const plan = this.plan(tasks)
    if (plan.hasCycles) throw new Error("Task graph contains a circular dependency.")
    const now = Date.now()
    const run: MultiAgentRun = {
      id: runId(),
      specId,
      title,
      projectRoot: this.projectRoot,
      baseCommit: currentCommit(this.projectRoot),
      status: "planned",
      waves: plan.waves,
      tasks: tasks
        .filter((task) => task.status !== "completed")
        .map((task): IsolatedTaskRecord => ({
          id: task.id,
          title: task.title,
          description: task.description,
          dependencies: [...task.dependencies],
          claimedFiles: normalizeClaims(task.files),
          validation: task.validation,
          status: "pending",
        })),
      createdAt: now,
      updatedAt: now,
    }
    this.store.save(run)
    return run
  }

  get(id: string): MultiAgentRun {
    const run = this.store.load(id)
    if (!run) throw new Error(`Multi-agent run not found: ${id}`)
    return run
  }

  list(): MultiAgentRun[] {
    return this.store.list()
  }

  allocate(runIdValue: string, taskId: number): IsolatedTaskRecord {
    const run = this.get(runIdValue)
    const task = this.task(run, taskId)
    if (!["pending", "blocked", "interrupted", "failed", "conflict"].includes(task.status)) {
      throw new Error(`Task ${taskId} cannot be allocated from state ${task.status}`)
    }
    const incompleteDependency = task.dependencies.find((id) => run.tasks.some((candidate) => candidate.id === id && candidate.status !== "integrated"))
    if (incompleteDependency !== undefined) throw new Error(`Task ${taskId} is blocked by dependency ${incompleteDependency}`)
    task.status = "allocating"
    task.error = undefined
    this.store.save(run)
    try {
      task.lease = this.locks.acquire(owner(run.id, task.id), task.claimedFiles)
      const allocationBase = currentCommit(this.projectRoot)
      const allocated = this.worktrees.create(run.id, task.id, task.title, allocationBase)
      task.branch = allocated.branch
      task.worktreePath = allocated.path
      task.baseCommit = allocationBase
      task.startedAt = Date.now()
      task.status = "running"
      run.status = "running"
      run.startedAt ??= Date.now()
      this.store.save(run)
      return task
    } catch (error) {
      this.locks.release(owner(run.id, task.id))
      task.status = "failed"
      task.error = (error as Error).message
      this.store.save(run)
      throw error
    }
  }

  finalize(runIdValue: string, taskId: number): TaskFinalizeResult {
    const run = this.get(runIdValue)
    const task = this.task(run, taskId)
    if (!task.worktreePath) throw new Error(`Task ${taskId} has no worktree`)
    task.status = "reviewing"
    this.store.save(run)
    const result = finalizeTask(
      task.worktreePath,
      task.claimedFiles,
      task.validation,
      `spectra(${run.id}): task ${task.id} ${task.title}`,
    )
    task.actualFiles = result.inspection.changedFiles
    task.unclaimedFiles = result.inspection.unclaimedFiles
    task.finishedAt = Date.now()
    if (result.ok) {
      task.commit = result.commit
      task.status = "ready"
      task.error = undefined
    } else {
      task.status = "failed"
      task.error = result.error
      this.locks.release(owner(run.id, task.id))
      task.lease = undefined
    }
    this.store.save(run)
    return result
  }

  integrate(runIdValue: string, taskId: number): TaskIntegrationResult {
    const run = this.get(runIdValue)
    const task = this.task(run, taskId)
    if (task.status !== "ready" || !task.commit) throw new Error(`Task ${taskId} is not ready for integration`)
    task.status = "integrating"
    run.status = "integrating"
    this.store.save(run)
    const result = integrateTask(this.projectRoot, task.commit, task.validation)
    if (result.ok) {
      task.status = "integrated"
      task.integratedAt = Date.now()
      task.error = undefined
      this.cleanupTask(run, task)
      if (run.tasks.every((candidate) => candidate.status === "integrated" || candidate.status === "cancelled")) {
        run.status = "completed"
        run.finishedAt = Date.now()
      } else {
        run.status = "running"
      }
    } else {
      task.status = result.conflictFiles?.length ? "conflict" : "failed"
      task.error = result.error
      run.status = "failed"
      run.error = result.error
      this.locks.release(owner(run.id, task.id))
      task.lease = undefined
    }
    this.store.save(run)
    return result
  }

  cancel(runIdValue: string): MultiAgentRun {
    const run = this.get(runIdValue)
    for (const task of run.tasks) {
      if (!["integrated", "cancelled"].includes(task.status)) {
        task.status = "cancelled"
        this.cleanupTask(run, task)
      }
    }
    run.status = "cancelled"
    run.finishedAt = Date.now()
    this.store.save(run)
    return run
  }

  async execute(runIdValue: string, runner: IsolatedAgentRunner, onEvent?: (message: string) => void): Promise<MultiAgentRun> {
    const run = this.get(runIdValue)
    if (!isWorkingTreeClean(this.projectRoot)) throw new Error("Main workspace must remain clean during isolated execution.")
    run.status = "running"
    run.startedAt ??= Date.now()
    this.store.save(run)

    for (const wave of run.waves) {
      const waveTasks = wave.taskIds.map((id) => this.task(run, id)).filter((task) => !["integrated", "cancelled"].includes(task.status))
      if (waveTasks.length === 0) continue
      const blocked = waveTasks.filter((task) => task.dependencies.some((dependency) => {
        const dep = run.tasks.find((candidate) => candidate.id === dependency)
        return dep && dep.status !== "integrated"
      }))
      for (const task of blocked) task.status = "blocked"
      const runnable = waveTasks.filter((task) => !blocked.includes(task))
      this.store.save(run)

      const results = await Promise.all(runnable.map(async (task) => {
        try {
          const allocated = this.allocate(run.id, task.id)
          onEvent?.(`Task ${task.id} allocated to ${allocated.branch}`)
          const sourceTask: Task = {
            id: task.id,
            title: task.title,
            description: task.description,
            dependencies: task.dependencies,
            files: task.claimedFiles,
            validation: task.validation,
            status: "in_progress",
          }
          const heartbeat = setInterval(() => this.locks.renew(owner(run.id, task.id)), 60_000)
          let executed
          try {
            executed = await runner.run(sourceTask, allocated.worktreePath!)
          } finally {
            clearInterval(heartbeat)
          }
          if (!executed.success) throw new Error(executed.error ?? "Agent failed")
          const finalized = this.finalize(run.id, task.id)
          if (!finalized.ok) throw new Error(finalized.error ?? "Review failed")
          return { taskId: task.id, ok: true as const }
        } catch (error) {
          const fresh = this.get(run.id)
          const failed = this.task(fresh, task.id)
          failed.status = "failed"
          failed.error = (error as Error).message
          this.locks.release(owner(run.id, task.id))
          failed.lease = undefined
          fresh.status = "failed"
          fresh.error = failed.error
          this.store.save(fresh)
          return { taskId: task.id, ok: false as const, error: failed.error }
        }
      }))

      // Preserve successful siblings even when another task in the same wave
      // fails. Their reviewed commits are integrated first; a later retry only
      // needs to rerun the failed task instead of discarding completed work.
      for (const task of runnable.sort((a, b) => a.id - b.id)) {
        const freshTask = this.task(this.get(run.id), task.id)
        if (freshTask.status !== "ready") continue
        onEvent?.(`Integrating task ${task.id}`)
        const integrated = this.integrate(run.id, task.id)
        if (!integrated.ok) break
      }
      if (results.some((result) => !result.ok) || this.get(run.id).status === "failed") break
    }

    const final = this.get(run.id)
    if (final.status === "running" || final.status === "integrating") {
      final.status = final.tasks.every((task) => task.status === "integrated" || task.status === "cancelled") ? "completed" : "failed"
      final.finishedAt = Date.now()
      this.store.save(final)
    }
    return this.get(run.id)
  }

  recover(): void {
    for (const run of this.store.list()) {
      let changed = false
      if (["running", "integrating"].includes(run.status)) {
        run.status = "interrupted"
        changed = true
      }
      for (const task of run.tasks) {
        if (["allocating", "running", "reviewing", "integrating"].includes(task.status)) {
          task.status = task.worktreePath && existsSync(task.worktreePath) ? "interrupted" : "failed"
          task.error ??= "Spectra stopped while this task was active."
          this.locks.release(owner(run.id, task.id))
          task.lease = undefined
          changed = true
        }
      }
      if (changed) this.store.save(run)
    }
  }

  private cleanupTask(run: MultiAgentRun, task: IsolatedTaskRecord): void {
    this.locks.release(owner(run.id, task.id))
    task.lease = undefined
    if (task.worktreePath) {
      try { this.worktrees.remove(task.worktreePath, task.branch, true) } catch { /* recoverable */ }
    }
    task.worktreePath = undefined
  }

  private task(run: MultiAgentRun, id: number): IsolatedTaskRecord {
    const task = run.tasks.find((candidate) => candidate.id === id)
    if (!task) throw new Error(`Task ${id} not found in run ${run.id}`)
    return task
  }
}
