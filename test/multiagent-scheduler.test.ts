import test from "node:test"
import assert from "node:assert/strict"
import { planIsolatedTasks } from "../src/multiagent/scheduler.js"
import type { Task } from "../src/spec/types.js"

const task = (id: number, files: string[], dependencies: number[] = []): Task => ({
  id, title: `task ${id}`, description: "", files, dependencies, validation: "", status: "pending",
})

test("isolated scheduler parallelizes disjoint file claims", () => {
  const plan = planIsolatedTasks([task(1, ["src/a.ts"]), task(2, ["src/b.ts"])], 4)
  assert.deepEqual(plan.waves[0]?.taskIds, [1, 2])
})

test("isolated scheduler serializes overlapping file claims", () => {
  const plan = planIsolatedTasks([task(1, ["src"]), task(2, ["src/b.ts"])], 4)
  assert.deepEqual(plan.waves.map((wave) => wave.taskIds), [[1], [2]])
  assert.equal(plan.conflicts.length, 1)
})

test("isolated scheduler preserves declared dependencies", () => {
  const plan = planIsolatedTasks([task(1, ["a"]), task(2, ["b"], [1])], 4)
  assert.deepEqual(plan.waves.map((wave) => wave.taskIds), [[1], [2]])
})

test("tasks without file claims are conservative exclusive writers", () => {
  const plan = planIsolatedTasks([task(1, []), task(2, ["src/b.ts"])], 4)
  assert.deepEqual(plan.waves.map((wave) => wave.taskIds), [[1], [2]])
})
