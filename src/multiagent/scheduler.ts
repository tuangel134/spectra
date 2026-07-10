import type { Task } from "../spec/types.js"
import { conflictingClaims, normalizeClaims } from "./paths.js"
import type { IsolationPlan, MultiAgentWave } from "./types.js"

export function planIsolatedTasks(tasks: Task[], maxParallel = 4): IsolationPlan {
  const pending = tasks.filter((task) => task.status !== "completed")
  const byId = new Map(pending.map((task) => [task.id, task]))
  const completed = new Set(tasks.filter((task) => task.status === "completed").map((task) => task.id))
  const remaining = new Set(pending.map((task) => task.id))
  const waves: MultiAgentWave[] = []
  const conflicts: IsolationPlan["conflicts"] = []

  for (let i = 0; i < pending.length; i++) {
    for (let j = i + 1; j < pending.length; j++) {
      const left = pending[i]!
      const right = pending[j]!
      const overlap = conflictingClaims(left.files, right.files)
      if (overlap.length > 0) conflicts.push({ left: left.id, right: right.id, claims: overlap })
    }
  }

  while (remaining.size > 0) {
    const ready = [...remaining]
      .map((id) => byId.get(id)!)
      .filter((task) => task.dependencies.every((dependency) => completed.has(dependency)))
      .sort((a, b) => a.id - b.id)

    if (ready.length === 0) return { waves, conflicts, hasCycles: true }

    const selected: Task[] = []
    for (const task of ready) {
      if (selected.length >= Math.max(1, maxParallel)) break
      const claims = normalizeClaims(task.files)
      if (selected.every((other) => conflictingClaims(claims, other.files).length === 0)) selected.push(task)
    }
    if (selected.length === 0) selected.push(ready[0]!)

    const wave: MultiAgentWave = { number: waves.length + 1, taskIds: selected.map((task) => task.id) }
    waves.push(wave)
    for (const task of selected) {
      remaining.delete(task.id)
      completed.add(task.id)
    }
  }

  return { waves, conflicts, hasCycles: false }
}
