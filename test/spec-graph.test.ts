import { test } from "node:test"
import assert from "node:assert/strict"

import { DependencyGraph } from "../src/spec/graph.ts"
import type { Task } from "../src/spec/types.ts"

function task(id: number, deps: number[]): Task {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    status: "pending",
    dependencies: deps,
    files: [],
    validation: "",
  }
}

test("waves group independent tasks together", () => {
  const tasks = [task(1, []), task(2, []), task(3, [1]), task(4, [1, 2]), task(5, [3, 4])]
  const graph = new DependencyGraph(tasks)
  const waves = graph.waves()

  assert.equal(waves.length, 3)
  assert.deepEqual(
    waves[0]!.tasks.map((t) => t.id).sort(),
    [1, 2],
  )
  assert.deepEqual(
    waves[1]!.tasks.map((t) => t.id).sort(),
    [3, 4],
  )
  assert.deepEqual(waves[2]!.tasks.map((t) => t.id), [5])
})

test("hasCycles detects circular dependencies", () => {
  const tasks = [task(1, [2]), task(2, [1])]
  const graph = new DependencyGraph(tasks)
  assert.equal(graph.hasCycles(), true)
})

test("hasCycles returns false for a DAG", () => {
  const tasks = [task(1, []), task(2, [1]), task(3, [2])]
  const graph = new DependencyGraph(tasks)
  assert.equal(graph.hasCycles(), false)
})

test("criticalPath finds the longest chain", () => {
  const tasks = [task(1, []), task(2, [1]), task(3, [2]), task(4, [])]
  const graph = new DependencyGraph(tasks)
  assert.deepEqual(graph.criticalPath(), [1, 2, 3])
})
