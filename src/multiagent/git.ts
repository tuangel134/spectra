import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { createHash } from "node:crypto"

export interface GitResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

export function runGit(cwd: string, args: string[], timeout = 120_000): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    timeout,
    windowsHide: true,
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024,
  })
  return {
    ok: result.status === 0,
    code: result.status,
    stdout: result.stdout?.toString("utf-8").replace(/\r?\n$/, "") ?? "",
    stderr: result.stderr?.toString("utf-8").replace(/\r?\n$/, "") ?? result.error?.message ?? "",
  }
}

export function requireGitRepository(projectRoot: string): void {
  const result = runGit(projectRoot, ["rev-parse", "--show-toplevel"])
  if (!result.ok) throw new Error(`Multi-agent isolation requires a Git repository: ${result.stderr}`)
}

export function currentCommit(projectRoot: string): string {
  const result = runGit(projectRoot, ["rev-parse", "HEAD"])
  if (!result.ok || !result.stdout) throw new Error(`Cannot resolve current Git commit: ${result.stderr}`)
  return result.stdout
}

export function isWorkingTreeClean(projectRoot: string): boolean {
  return runGit(projectRoot, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout === ""
}

export function changedFiles(projectRoot: string): string[] {
  const tracked = runGit(projectRoot, ["diff", "--name-only", "-z", "HEAD"])
  if (!tracked.ok) throw new Error(tracked.stderr || "git diff failed")
  const untracked = runGit(projectRoot, ["ls-files", "--others", "--exclude-standard", "-z"])
  if (!untracked.ok) throw new Error(untracked.stderr || "git ls-files failed")
  return [...new Set((tracked.stdout + untracked.stdout).split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/")))].sort()
}

export function worktreeBaseDir(projectRoot: string): string {
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 10)
  return join(dirname(projectRoot), `.${basename(projectRoot)}-spectra-worktrees-${hash}`)
}

export function sanitizeBranchPart(input: string): string {
  const value = input.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return value.slice(0, 60) || "task"
}

export class GitWorktreeManager {
  readonly baseDir: string

  constructor(readonly projectRoot: string) {
    requireGitRepository(projectRoot)
    this.baseDir = worktreeBaseDir(projectRoot)
    mkdirSync(this.baseDir, { recursive: true })
  }

  create(runId: string, taskId: number, title: string, baseCommit: string): { branch: string; path: string } {
    const runPart = sanitizeBranchPart(runId)
    const branch = `spectra/${runPart}/task-${taskId}-${sanitizeBranchPart(title).slice(0, 24)}`
    const path = join(this.baseDir, runPart, `task-${taskId}`)
    if (existsSync(path)) this.remove(path, branch, true)
    mkdirSync(dirname(path), { recursive: true })
    const result = runGit(this.projectRoot, ["worktree", "add", "-b", branch, path, baseCommit], 180_000)
    if (!result.ok) throw new Error(`Failed to create isolated worktree: ${result.stderr}`)
    return { branch, path }
  }

  remove(path: string, branch?: string, force = false): void {
    if (existsSync(path)) {
      const args = ["worktree", "remove"]
      if (force) args.push("--force")
      args.push(path)
      const result = runGit(this.projectRoot, args, 120_000)
      if (!result.ok && !force) throw new Error(`Failed to remove worktree: ${result.stderr}`)
      if (!result.ok) rmSync(path, { recursive: true, force: true })
    }
    runGit(this.projectRoot, ["worktree", "prune"])
    if (branch) runGit(this.projectRoot, ["branch", "-D", branch])
  }

  exists(path: string | undefined): boolean {
    return Boolean(path && existsSync(path))
  }
}
