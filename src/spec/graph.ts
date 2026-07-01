/**
 * Task dependency graph.
 *
 * Computes parallel execution waves, detects cycles, and finds the critical path.
 */

import type { Task, Wave } from "./types.js"

export class DependencyGraph {
  private readonly deps = new Map<number, number[]>()

  constructor(private readonly tasks: Task[]) {
    for (const task of tasks) {
      this.deps.set(task.id, task.dependencies)
    }
  }

  /** Detect whether the graph contains a cycle. */
  hasCycles(): boolean {
    const visited = new Set<number>()
    const stack = new Set<number>()

    const visit = (id: number): boolean => {
      visited.add(id)
      stack.add(id)
      for (const dep of this.deps.get(id) ?? []) {
        if (!this.deps.has(dep)) continue // external/missing dep
        if (!visited.has(dep)) {
          if (visit(dep)) return true
        } else if (stack.has(dep)) {
          return true
        }
      }
      stack.delete(id)
      return false
    }

    for (const id of this.deps.keys()) {
      if (!visited.has(id) && visit(id)) return true
    }
    return false
  }

  /**
   * Group tasks into execution waves.
   * Wave N contains all tasks whose dependencies were satisfied by waves < N.
   */
  waves(): Wave[] {
    const result: Wave[] = []
    const completed = new Set<number>()
    const remaining = new Set(this.tasks.map((t) => t.id))
    let waveNumber = 1

    while (remaining.size > 0) {
      const ready: Task[] = []

      for (const id of remaining) {
        const task = this.byId(id)!
        const satisfied = task.dependencies.every(
          (dep) => completed.has(dep) || !this.deps.has(dep),
        )
        if (satisfied) ready.push(task)
      }

      if (ready.length === 0) {
        // Cycle or unresolvable deps: emit the rest as a final wave.
        const rest = Array.from(remaining).map((id) => this.byId(id)!)
        result.push({ number: waveNumber, tasks: rest })
        break
      }

      result.push({ number: waveNumber, tasks: ready })
      for (const task of ready) {
        completed.add(task.id)
        remaining.delete(task.id)
      }
      waveNumber++
    }

    return result
  }

  /** Return the longest dependency chain (critical path) as task ids. */
  criticalPath(): number[] {
    const memo = new Map<number, number[]>()

    const longestFrom = (id: number, seen: Set<number>): number[] => {
      if (memo.has(id)) return memo.get(id)!
      // Cycle guard: if we re-enter a node already on the current DFS stack,
      // stop instead of recursing forever (criticalPath is reachable without a
      // prior hasCycles() check).
      if (seen.has(id)) return [id]
      seen.add(id)
      const deps = (this.deps.get(id) ?? []).filter((d) => this.deps.has(d))
      let best: number[] = []
      for (const dep of deps) {
        const path = longestFrom(dep, seen)
        if (path.length > best.length) best = path
      }
      seen.delete(id)
      const result = [...best, id]
      memo.set(id, result)
      return result
    }

    let longest: number[] = []
    for (const id of this.deps.keys()) {
      const path = longestFrom(id, new Set())
      if (path.length > longest.length) longest = path
    }
    return longest
  }

  private byId(id: number): Task | undefined {
    return this.tasks.find((t) => t.id === id)
  }
}
