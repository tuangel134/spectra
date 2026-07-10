import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { currentCommit, GitWorktreeManager, runGit } from "../src/multiagent/git.js"
import { finalizeTask, integrateTask } from "../src/multiagent/review.js"

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "spectra-worktree-"))
  runGit(root, ["init"])
  runGit(root, ["config", "user.name", "Test"])
  runGit(root, ["config", "user.email", "test@example.com"])
  writeFileSync(join(root, "app.txt"), "base\n")
  runGit(root, ["add", "app.txt"])
  runGit(root, ["commit", "-m", "base"])
  return root
}

test("isolated worktree is reviewed, committed, and integrated", () => {
  const root = repo()
  const manager = new GitWorktreeManager(root)
  try {
    const allocated = manager.create("run-one", 1, "edit app", currentCommit(root))
    writeFileSync(join(allocated.path, "app.txt"), "isolated\n")
    const finalized = finalizeTask(allocated.path, ["app.txt"], "", "task commit")
    assert.equal(finalized.ok, true)
    const integrated = integrateTask(root, finalized.commit!, "")
    assert.equal(integrated.ok, true)
    assert.equal(readFileSync(join(root, "app.txt"), "utf-8"), "isolated\n")
    manager.remove(allocated.path, allocated.branch, true)
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(manager.baseDir, { recursive: true, force: true }) }
})

test("review rejects files outside the task claim", () => {
  const root = repo()
  const manager = new GitWorktreeManager(root)
  try {
    const allocated = manager.create("run-two", 2, "bad edit", currentCommit(root))
    writeFileSync(join(allocated.path, "other.txt"), "not claimed\n")
    const finalized = finalizeTask(allocated.path, ["app.txt"], "", "task commit")
    assert.equal(finalized.ok, false)
    assert.deepEqual(finalized.inspection.unclaimedFiles, ["other.txt"])
    manager.remove(allocated.path, allocated.branch, true)
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(manager.baseDir, { recursive: true, force: true }) }
})


test("validation-generated files outside the claim are rejected", () => {
  const root = repo()
  const manager = new GitWorktreeManager(root)
  try {
    const allocated = manager.create("run-validation-scope", 3, "validate scope", currentCommit(root))
    writeFileSync(join(allocated.path, "app.txt"), "isolated\n")
    const command = process.platform === "win32"
      ? 'node -e "require(\'fs\').writeFileSync(\'generated.txt\',\'bad\\n\')"'
      : "node -e \"require('fs').writeFileSync('generated.txt','bad\\n')\""
    const finalized = finalizeTask(allocated.path, ["app.txt"], command, "task commit")
    assert.equal(finalized.ok, false)
    assert.deepEqual(finalized.inspection.unclaimedFiles, ["generated.txt"])
    manager.remove(allocated.path, allocated.branch, true)
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(manager.baseDir, { recursive: true, force: true }) }
})

test("integration rolls back when validation dirties main", () => {
  const root = repo()
  const manager = new GitWorktreeManager(root)
  try {
    const before = currentCommit(root)
    const allocated = manager.create("run-main-dirty", 4, "dirty validation", before)
    writeFileSync(join(allocated.path, "app.txt"), "isolated\n")
    const finalized = finalizeTask(allocated.path, ["app.txt"], "", "task commit")
    assert.equal(finalized.ok, true)
    const command = process.platform === "win32"
      ? 'node -e "require(\'fs\').writeFileSync(\'generated.txt\',\'bad\\n\')"'
      : "node -e \"require('fs').writeFileSync('generated.txt','bad\\n')\""
    const integrated = integrateTask(root, finalized.commit!, command)
    assert.equal(integrated.ok, false)
    assert.match(integrated.error ?? "", /modified the main workspace/)
    assert.equal(currentCommit(root), before)
    assert.equal(readFileSync(join(root, "app.txt"), "utf-8"), "base\n")
    manager.remove(allocated.path, allocated.branch, true)
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(manager.baseDir, { recursive: true, force: true }) }
})
