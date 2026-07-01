import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SpecEngine } from "../src/spec/engine.ts"
import type { Task } from "../src/spec/types.ts"

function withEngine(fn: (engine: SpecEngine, dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "spectra-spec-"))
    try {
      const engine = new SpecEngine({
        projectRoot: dir,
        outputDir: ".spectra/specs",
        maxParallelTasks: 2,
      })
      await fn(engine, dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test(
  "create writes spec metadata to disk",
  withEngine(async (engine) => {
    const meta = engine.create("Add notifications", "feature")
    assert.equal(meta.type, "feature")
    assert.ok(existsSync(join(engine.specDir(meta.id), "spec.json")))
    const reloaded = engine.readMeta(meta.id)
    assert.equal(reloaded?.title, "Add notifications")
  }),
)

test(
  "write and load tasks round-trips",
  withEngine(async (engine) => {
    const meta = engine.create("Feature X", "feature")
    engine.writeTasks(
      meta.id,
      `# Tasks: Feature X

- [ ] Task 1: First
  - Dependencies: []
  - Files: [a.ts]
  - Validation: test

- [ ] Task 2: Second
  - Dependencies: [1]
  - Files: [b.ts]
  - Validation: test
`,
    )
    const tasks = engine.loadTasks(meta.id)
    assert.equal(tasks.length, 2)
    assert.deepEqual(tasks[1]!.dependencies, [1])
  }),
)

test(
  "execute runs tasks in dependency order and reports results",
  withEngine(async (engine) => {
    const meta = engine.create("Feature Y", "feature")
    const tasks: Task[] = [
      { id: 1, title: "A", description: "", status: "pending", dependencies: [], files: [], validation: "" },
      { id: 2, title: "B", description: "", status: "pending", dependencies: [1], files: [], validation: "" },
      { id: 3, title: "C", description: "", status: "pending", dependencies: [1], files: [], validation: "" },
    ]
    engine.writeTasks(meta.id, "# Tasks: Feature Y\n")

    const executionOrder: number[] = []
    const report = await engine.execute(meta.id, "Feature Y", tasks, {
      async run(task) {
        executionOrder.push(task.id)
        return { success: true }
      },
    })

    assert.equal(report.completed, 3)
    assert.equal(report.failed, 0)
    // Task 1 must run before 2 and 3.
    assert.equal(executionOrder[0], 1)
    assert.ok(executionOrder.indexOf(2) > 0)
    assert.ok(executionOrder.indexOf(3) > 0)
  }),
)

test(
  "execute skips tasks whose dependencies failed",
  withEngine(async (engine) => {
    const meta = engine.create("Feature Z", "feature")
    const tasks: Task[] = [
      { id: 1, title: "A", description: "", status: "pending", dependencies: [], files: [], validation: "" },
      { id: 2, title: "B", description: "", status: "pending", dependencies: [1], files: [], validation: "" },
    ]
    engine.writeTasks(meta.id, "# Tasks: Feature Z\n")

    const report = await engine.execute(meta.id, "Feature Z", tasks, {
      async run(task) {
        if (task.id === 1) return { success: false, error: "boom" }
        return { success: true }
      },
    })

    assert.equal(report.failed, 1)
    assert.equal(report.skipped, 1)
    assert.equal(report.completed, 0)
  }),
)

test(
  "execute throws on circular dependencies",
  withEngine(async (engine) => {
    const meta = engine.create("Cyclic", "feature")
    const tasks: Task[] = [
      { id: 1, title: "A", description: "", status: "pending", dependencies: [2], files: [], validation: "" },
      { id: 2, title: "B", description: "", status: "pending", dependencies: [1], files: [], validation: "" },
    ]
    engine.writeTasks(meta.id, "# Tasks: Cyclic\n")

    await assert.rejects(() =>
      engine.execute(meta.id, "Cyclic", tasks, { async run() { return { success: true } } }),
    )
  }),
)
