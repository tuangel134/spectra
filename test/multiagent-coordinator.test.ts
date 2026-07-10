import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { MultiAgentCoordinator } from "../src/multiagent/coordinator.js"
import { runGit } from "../src/multiagent/git.js"
import type { Task } from "../src/spec/types.js"

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "spectra-coordinator-"))
  runGit(root, ["init"])
  runGit(root, ["config", "user.name", "Test"])
  runGit(root, ["config", "user.email", "test@example.com"])
  writeFileSync(join(root, "a.txt"), "a\n")
  writeFileSync(join(root, "b.txt"), "b\n")
  runGit(root, ["add", "."])
  runGit(root, ["commit", "-m", "base"])
  return root
}

const tasks: Task[] = [
  { id: 1, title: "A", description: "", dependencies: [], files: ["a.txt"], validation: "", status: "pending" },
  { id: 2, title: "B", description: "", dependencies: [], files: ["b.txt"], validation: "", status: "pending" },
]

test("coordinator persists a conflict-aware run", () => {
  const root = makeRepo()
  const coordinator = new MultiAgentCoordinator(root, 4)
  const worktreeBase = coordinator.worktrees.baseDir
  const stateBase = dirname(coordinator.store.dir)
  try {
    const run = coordinator.create("demo", tasks, "spec-1")
    assert.equal(run.waves.length, 1)
    assert.deepEqual(coordinator.get(run.id).waves[0]?.taskIds, [1, 2])
    assert.equal(coordinator.list()[0]?.id, run.id)
  } finally {
    rmSync(worktreeBase, { recursive: true, force: true })
    rmSync(stateBase, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test("coordinator recovers interrupted task state", () => {
  const root = makeRepo()
  const coordinator = new MultiAgentCoordinator(root, 1)
  const worktreeBase = coordinator.worktrees.baseDir
  const stateBase = dirname(coordinator.store.dir)
  try {
    const run = coordinator.create("recover", [tasks[0]!])
    const allocated = coordinator.allocate(run.id, 1)
    assert.equal(allocated.status, "running")
    const recovered = new MultiAgentCoordinator(root, 1).get(run.id)
    assert.equal(recovered.status, "interrupted")
    assert.equal(recovered.tasks[0]?.status, "interrupted")
    coordinator.cancel(run.id)
  } finally {
    rmSync(worktreeBase, { recursive: true, force: true })
    rmSync(stateBase, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})


test("coordinator integrates successful siblings before reporting a wave failure", async () => {
  const root = makeRepo()
  const coordinator = new MultiAgentCoordinator(root, 2)
  const worktreeBase = coordinator.worktrees.baseDir
  const stateBase = dirname(coordinator.store.dir)
  try {
    const run = coordinator.create("partial wave", tasks)
    const first = await coordinator.execute(run.id, {
      async run(task, worktreePath) {
        if (task.id === 2) return { success: false, error: "simulated failure" }
        writeFileSync(join(worktreePath, "a.txt"), "integrated-a\n")
        return { success: true }
      },
    })
    assert.equal(first.status, "failed")
    assert.equal(first.tasks.find((task) => task.id === 1)?.status, "integrated")
    assert.equal(first.tasks.find((task) => task.id === 2)?.status, "failed")
    assert.equal(readFileSync(join(root, "a.txt"), "utf-8"), "integrated-a\n")

    const retried = await coordinator.execute(run.id, {
      async run(task, worktreePath) {
        writeFileSync(join(worktreePath, task.id === 1 ? "a.txt" : "b.txt"), `integrated-${task.id}\n`)
        return { success: true }
      },
    })
    assert.equal(retried.status, "completed")
    assert.equal(readFileSync(join(root, "b.txt"), "utf-8"), "integrated-2\n")
  } finally {
    rmSync(worktreeBase, { recursive: true, force: true })
    rmSync(stateBase, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})
