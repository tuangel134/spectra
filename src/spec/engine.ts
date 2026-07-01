/**
 * Spec engine.
 *
 * Manages spec directories on disk and orchestrates wave-based task execution.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { join, resolve, relative, isAbsolute } from "node:path"

import type { Task, Wave, SpecType, SpecMeta, TaskStatus } from "./types.js"
import { DependencyGraph } from "./graph.js"
import { parseTasks, serializeTasks } from "./parser.js"
import { slugify } from "../util/id.js"

export interface SpecEngineOptions {
  projectRoot: string
  outputDir: string
  maxParallelTasks: number
}

export interface TaskRunner {
  /** Execute a single task; returns success and an optional error message. */
  run(task: Task): Promise<{ success: boolean; error?: string }>
}

export interface ExecutionReport {
  completed: number
  failed: number
  skipped: number
  total: number
  durationMs: number
  errors: { taskId: number; title: string; error: string }[]
}

export class SpecEngine {
  private readonly baseDir: string

  constructor(private readonly options: SpecEngineOptions) {
    this.baseDir = join(options.projectRoot, options.outputDir)
  }

  /** Create a spec directory and write its metadata. */
  create(title: string, type: SpecType): SpecMeta {
    const id = `${slugify(title)}-${Date.now().toString(36)}`
    const dir = join(this.baseDir, id)
    mkdirSync(dir, { recursive: true })

    const meta: SpecMeta = {
      id,
      title,
      type,
      createdAt: new Date().toISOString(),
    }
    writeFileSync(join(dir, "spec.json"), JSON.stringify(meta, null, 2))
    return meta
  }

  specDir(id: string): string {
    // Guard against path traversal: `id` can come from unsanitized user input
    // (e.g. `/run <id>`). The resolved directory MUST stay inside baseDir.
    const dir = resolve(this.baseDir, id)
    const rel = relative(this.baseDir, dir)
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Invalid spec id: ${id}`)
    }
    return dir
  }

  /** List all specs on disk (most recent first). */
  list(): SpecMeta[] {
    if (!existsSync(this.baseDir)) return []
    const metas: SpecMeta[] = []
    for (const entry of readdirSync(this.baseDir)) {
      const meta = this.readMeta(entry)
      if (meta) metas.push(meta)
    }
    return metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  /** Read a spec's metadata, or null if it does not exist. */
  readMeta(id: string): SpecMeta | null {
    const path = join(this.specDir(id), "spec.json")
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as SpecMeta
    } catch {
      return null
    }
  }

  writeRequirements(id: string, content: string): void {
    writeFileSync(join(this.specDir(id), "requirements.md"), content)
  }

  writeDesign(id: string, content: string): void {
    writeFileSync(join(this.specDir(id), "design.md"), content)
  }

  writeTasks(id: string, content: string): void {
    writeFileSync(join(this.specDir(id), "tasks.md"), content)
  }

  readDocument(id: string, doc: "requirements" | "design" | "tasks"): string | null {
    const path = join(this.specDir(id), `${doc}.md`)
    return existsSync(path) ? readFileSync(path, "utf-8") : null
  }

  /** Load and parse the task list for a spec. */
  loadTasks(id: string): Task[] {
    const md = this.readDocument(id, "tasks")
    return md ? parseTasks(md) : []
  }

  /** Compute the execution plan (waves of parallelizable tasks). */
  plan(tasks: Task[]): { waves: Wave[]; hasCycles: boolean } {
    const pending = tasks.filter((t) => t.status !== "completed")
    const graph = new DependencyGraph(pending)
    return { waves: graph.waves(), hasCycles: graph.hasCycles() }
  }

  /** Persist a task status change back to tasks.md. */
  updateTaskStatus(id: string, title: string, tasks: Task[], taskId: number, status: TaskStatus): void {
    const task = tasks.find((t) => t.id === taskId)
    if (task) task.status = status
    this.writeTasks(id, serializeTasks(title, tasks))
  }

  /**
   * Execute all pending tasks wave by wave, running tasks within a wave
   * concurrently (bounded by maxParallelTasks).
   */
  async execute(
    id: string,
    title: string,
    tasks: Task[],
    runner: TaskRunner,
    onStatusChange?: (taskId: number, status: TaskStatus) => void,
  ): Promise<ExecutionReport> {
    const start = Date.now()
    const report: ExecutionReport = {
      completed: 0,
      failed: 0,
      skipped: 0,
      total: tasks.filter((t) => t.status !== "completed").length,
      durationMs: 0,
      errors: [],
    }

    const { waves, hasCycles } = this.plan(tasks)
    if (hasCycles) {
      throw new Error("Task graph contains a circular dependency. Fix tasks.md before running.")
    }

    const failedIds = new Set<number>()

    for (const wave of waves) {
      // Skip tasks whose dependencies failed.
      const runnable = wave.tasks.filter(
        (t) => !t.dependencies.some((d) => failedIds.has(d)),
      )
      const skippedInWave = wave.tasks.length - runnable.length
      report.skipped += skippedInWave
      for (const t of wave.tasks) {
        if (!runnable.includes(t)) {
          failedIds.add(t.id)
          this.setStatus(id, title, tasks, t.id, "skipped", onStatusChange)
        }
      }

      // Run the wave in bounded-concurrency batches.
      for (let i = 0; i < runnable.length; i += this.options.maxParallelTasks) {
        const batch = runnable.slice(i, i + this.options.maxParallelTasks)
        const results = await Promise.all(
          batch.map(async (task) => {
            this.setStatus(id, title, tasks, task.id, "in_progress", onStatusChange)
            try {
              const res = await runner.run(task)
              return { task, ...res }
            } catch (err) {
              return { task, success: false, error: (err as Error).message }
            }
          }),
        )

        for (const r of results) {
          if (r.success) {
            report.completed++
            this.setStatus(id, title, tasks, r.task.id, "completed", onStatusChange)
          } else {
            report.failed++
            failedIds.add(r.task.id)
            report.errors.push({
              taskId: r.task.id,
              title: r.task.title,
              error: r.error ?? "unknown error",
            })
            this.setStatus(id, title, tasks, r.task.id, "failed", onStatusChange)
          }
        }
      }
    }

    report.durationMs = Date.now() - start
    return report
  }

  private setStatus(
    id: string,
    title: string,
    tasks: Task[],
    taskId: number,
    status: TaskStatus,
    onStatusChange?: (taskId: number, status: TaskStatus) => void,
  ): void {
    this.updateTaskStatus(id, title, tasks, taskId, status)
    onStatusChange?.(taskId, status)
  }
}
