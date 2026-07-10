import { spawnSync } from "node:child_process"
import { claimsAllowFile } from "./paths.js"
import { changedFiles, currentCommit, isWorkingTreeClean, runGit } from "./git.js"
import type { TaskFinalizeResult, TaskInspection, TaskIntegrationResult, VerificationResult } from "./types.js"

export function inspectTask(worktreePath: string, claimedFiles: string[]): TaskInspection {
  const files = changedFiles(worktreePath)
  const unclaimed = files.filter((file) => !claimsAllowFile(claimedFiles, file))
  return { changedFiles: files, unclaimedFiles: unclaimed, clean: files.length === 0 }
}

export function runValidation(cwd: string, command: string, timeout = 10 * 60_000): VerificationResult {
  const trimmed = command.trim()
  if (!trimmed) return { command: "", ok: true, exitCode: 0, stdout: "", stderr: "", durationMs: 0 }
  const started = Date.now()
  const shell = process.platform === "win32" ? (process.env["COMSPEC"] ?? "cmd.exe") : (process.env["SHELL"] ?? "/bin/sh")
  const args = process.platform === "win32" ? ["/d", "/s", "/c", trimmed] : ["-lc", trimmed]
  const result = spawnSync(shell, args, {
    cwd,
    timeout,
    windowsHide: true,
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  })
  return {
    command: trimmed,
    ok: result.status === 0,
    exitCode: result.status,
    stdout: String(result.stdout ?? "").slice(-100_000),
    stderr: String(result.stderr ?? result.error?.message ?? "").slice(-100_000),
    durationMs: Date.now() - started,
  }
}

function ensureGitIdentity(cwd: string): void {
  if (!runGit(cwd, ["config", "user.name"]).stdout) runGit(cwd, ["config", "user.name", "Spectra Agent"])
  if (!runGit(cwd, ["config", "user.email"]).stdout) runGit(cwd, ["config", "user.email", "spectra-agent@users.noreply.github.com"])
}

export function finalizeTask(
  worktreePath: string,
  claimedFiles: string[],
  validation: string,
  message: string,
): TaskFinalizeResult {
  let inspection = inspectTask(worktreePath, claimedFiles)
  if (inspection.clean) return { ok: false, inspection, error: "Agent produced no file changes." }
  if (inspection.unclaimedFiles.length > 0) {
    return {
      ok: false,
      inspection,
      error: `Agent changed files outside its claim: ${inspection.unclaimedFiles.join(", ")}`,
    }
  }
  const verification = runValidation(worktreePath, validation)
  if (!verification.ok) return { ok: false, inspection, verification, error: `Validation failed: ${validation}` }
  // Validation commands may format or generate files. Review the final patch,
  // not only the patch that existed before validation ran.
  inspection = inspectTask(worktreePath, claimedFiles)
  if (inspection.clean) return { ok: false, inspection, verification, error: "Validation removed every task change." }
  if (inspection.unclaimedFiles.length > 0) {
    return {
      ok: false,
      inspection,
      verification,
      error: `Validation changed files outside the task claim: ${inspection.unclaimedFiles.join(", ")}`,
    }
  }
  ensureGitIdentity(worktreePath)
  const add = runGit(worktreePath, ["add", "-A"])
  if (!add.ok) return { ok: false, inspection, verification, error: add.stderr }
  const commit = runGit(worktreePath, ["commit", "-m", message], 120_000)
  if (!commit.ok) return { ok: false, inspection, verification, error: commit.stderr || "git commit failed" }
  return { ok: true, inspection, verification, commit: currentCommit(worktreePath) }
}

export function integrateTask(
  projectRoot: string,
  commit: string,
  validation: string,
): TaskIntegrationResult {
  if (!isWorkingTreeClean(projectRoot)) {
    return { ok: false, error: "Main workspace has uncommitted changes. Commit or stash them before integration." }
  }
  const before = currentCommit(projectRoot)
  const cherryPick = runGit(projectRoot, ["cherry-pick", commit], 180_000)
  if (!cherryPick.ok) {
    const conflicts = runGit(projectRoot, ["diff", "--name-only", "--diff-filter=U"]).stdout
      .split(/\r?\n/).filter(Boolean)
    runGit(projectRoot, ["cherry-pick", "--abort"])
    return { ok: false, conflictFiles: conflicts, error: cherryPick.stderr || "Cherry-pick conflict" }
  }
  const verification = runValidation(projectRoot, validation)
  if (!verification.ok || !isWorkingTreeClean(projectRoot)) {
    runGit(projectRoot, ["reset", "--hard", before])
    runGit(projectRoot, ["clean", "-fd"])
    return {
      ok: false,
      verification,
      error: verification.ok
        ? "Integrated validation modified the main workspace and was rolled back."
        : "Integrated change failed validation and was rolled back.",
    }
  }
  return { ok: true, commit: currentCommit(projectRoot), verification }
}
