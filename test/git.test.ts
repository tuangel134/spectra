import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { gitStatusTool, gitCommitTool, gitBranchTool } from "../src/tool/git.ts"
import type { ToolContext } from "../src/tool/types.ts"

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "spectra-git-"))
  const run = (args: string[]) => spawnSync("git", args, { cwd: dir })
  run(["init", "-q"])
  run(["config", "user.email", "test@example.com"])
  run(["config", "user.name", "Test"])
  run(["checkout", "-b", "work"])
  return dir
}

function ctx(dir: string, approve = true): ToolContext {
  return {
    projectRoot: dir,
    agentId: "t",
    requestApproval: async () => approve,
    permissionFor: () => "allow",
    report: () => {},
  }
}

test("git_status reports the current branch and changes", async () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, "a.txt"), "hello")
    const res = await gitStatusTool.execute({}, ctx(dir))
    assert.equal(res.success, true)
    assert.equal(res.metadata?.branch, "work")
    assert.match(res.output, /a\.txt/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("git_commit stages and commits on a feature branch", async () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, "a.txt"), "hello")
    spawnSync("git", ["add", "a.txt"], { cwd: dir })
    spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: dir })
    writeFileSync(join(dir, "a.txt"), "changed")
    const res = await gitCommitTool.execute({ message: "fix: update a" }, ctx(dir))
    assert.equal(res.success, true)
    const log = spawnSync("git", ["log", "--oneline"], { cwd: dir }).stdout.toString()
    assert.match(log, /fix: update a/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("git_commit refuses a protected branch when not approved", async () => {
  const dir = repo()
  try {
    spawnSync("git", ["checkout", "-q", "-b", "main"], { cwd: dir })
    writeFileSync(join(dir, "a.txt"), "x")
    spawnSync("git", ["add", "a.txt"], { cwd: dir })
    const res = await gitCommitTool.execute({ message: "feat: x" }, ctx(dir, false))
    assert.equal(res.success, false)
    assert.match(res.output, /protected branch/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("git_branch validates the branch name", async () => {
  const dir = repo()
  try {
    const bad = await gitBranchTool.execute({ name: "bad name!" }, ctx(dir))
    assert.equal(bad.success, false)
    const good = await gitBranchTool.execute({ name: "feature/x" }, ctx(dir))
    assert.equal(good.success, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
