/**
 * Git tools — structured, safe git operations.
 *
 * Rather than make the agent hand-craft `bash` git invocations, these tools
 * provide structured status/diff/commit/branch operations with guardrails:
 *   - commits stage explicit paths (or tracked changes), never blindly `git add .`
 *   - destructive operations are not exposed here (no reset --hard / clean -f)
 *   - branch creation is preferred over committing straight to main
 */

import { spawn } from "node:child_process"

import type { Tool, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { truncate } from "./fs-helpers.js"

interface GitRun {
  code: number
  stdout: string
  stderr: string
}

/** Run a git command as an argv array (no shell — injection-safe). */
function git(args: string[], cwd: string, timeoutMs = 30_000): Promise<GitRun> {
  return new Promise<GitRun>((resolve) => {
    const child = spawn("git", args, { cwd, env: process.env })
    let stdout = ""
    let stderr = ""
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      child.kill("SIGKILL")
    }, timeoutMs)
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()))
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()))
    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({ code: 127, stdout, stderr: err.message })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: killed ? 124 : (code ?? 1), stdout, stderr })
    })
  })
}

const PROTECTED_BRANCHES = new Set(["main", "master", "develop", "production"])

/** Current branch name, robust on unborn branches (no commits yet). */
async function currentBranch(cwd: string): Promise<{ ok: boolean; name: string }> {
  const show = await git(["branch", "--show-current"], cwd)
  if (show.code === 0) return { ok: true, name: show.stdout.trim() }
  const rev = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
  return { ok: rev.code === 0, name: rev.stdout.trim() }
}

export const gitStatusTool: Tool = {
  name: "git_status",
  description: "Show the working tree status (branch, staged, unstaged, untracked files).",
  category: "shell",
  parameters: objectSchema({}, []),
  async execute(_args, ctx): Promise<ToolResult> {
    const inside = await git(["rev-parse", "--is-inside-work-tree"], ctx.projectRoot)
    if (inside.code !== 0) return { success: false, output: "Not a git repository (or git unavailable)." }
    const branch = await currentBranch(ctx.projectRoot)
    const status = await git(["status", "--short", "--branch"], ctx.projectRoot)
    return { success: true, output: truncate(status.stdout || "(clean)", 8000), metadata: { branch: branch.name } }
  },
}

export const gitDiffTool: Tool = {
  name: "git_diff",
  description: "Show the diff of changes. Pass staged:true for the staged diff, or a path to scope it.",
  category: "shell",
  parameters: objectSchema(
    {
      staged: { type: "boolean", description: "Show staged changes instead of unstaged" },
      path: { type: "string", description: "Limit the diff to a path" },
    },
    [],
  ),
  async execute(args, ctx): Promise<ToolResult> {
    const gitArgs = ["diff"]
    if (args["staged"]) gitArgs.push("--staged")
    if (args["path"]) gitArgs.push("--", String(args["path"]))
    const res = await git(gitArgs, ctx.projectRoot)
    if (res.code !== 0) return { success: false, output: res.stderr || "git diff failed" }
    return { success: true, output: truncate(res.stdout || "(no changes)", 20_000) }
  },
}

export const gitBranchTool: Tool = {
  name: "git_branch",
  description: "Create and switch to a new branch (safer than committing to main directly).",
  category: "shell",
  parameters: objectSchema({ name: { type: "string", description: "New branch name" } }, ["name"]),
  async execute(args, ctx): Promise<ToolResult> {
    const name = String(args["name"] ?? "").trim()
    if (!name || !/^[\w./-]+$/.test(name)) {
      return { success: false, output: "Error: provide a valid branch name (letters, digits, / . _ -)." }
    }
    const res = await git(["checkout", "-b", name], ctx.projectRoot)
    if (res.code !== 0) return { success: false, output: res.stderr || "Failed to create branch" }
    return { success: true, output: `Created and switched to branch "${name}".` }
  },
}

export const gitCommitTool: Tool = {
  name: "git_commit",
  description:
    "Stage specific paths and create a commit. Provide a conventional-commit message. " +
    "Commits to protected branches (main/master) require confirmation.",
  category: "shell",
  parameters: objectSchema(
    {
      message: { type: "string", description: "Commit message (e.g. 'feat: add login')" },
      paths: { type: "array", items: { type: "string" }, description: "Paths to stage (default: all tracked changes)" },
    },
    ["message"],
  ),
  async execute(args, ctx): Promise<ToolResult> {
    const message = String(args["message"] ?? "").trim()
    if (!message) return { success: false, output: "Error: 'message' is required." }

    const level = ctx.permissionFor("bash", "git commit")
    if (level === "deny") return { success: false, output: "Error: git commit denied by permissions." }

    const branch = (await currentBranch(ctx.projectRoot)).name
    if (PROTECTED_BRANCHES.has(branch)) {
      const ok = await ctx.requestApproval("git_commit", `Commit directly to protected branch "${branch}"?`)
      if (!ok) return { success: false, output: `Refused: declined to commit to protected branch "${branch}". Create a branch first.` }
    } else if (level === "ask") {
      const ok = await ctx.requestApproval("git_commit", `Commit "${message}" on ${branch}`)
      if (!ok) return { success: false, output: "Commit rejected by user." }
    }

    const paths = Array.isArray(args["paths"]) ? (args["paths"] as string[]) : null
    const stage = paths && paths.length > 0 ? await git(["add", "--", ...paths], ctx.projectRoot) : await git(["add", "-u"], ctx.projectRoot)
    if (stage.code !== 0) return { success: false, output: stage.stderr || "git add failed" }

    const commit = await git(["commit", "-m", message], ctx.projectRoot)
    if (commit.code !== 0) {
      return { success: false, output: commit.stderr || commit.stdout || "git commit failed (nothing to commit?)" }
    }
    return { success: true, output: truncate(commit.stdout, 4000), metadata: { branch } }
  },
}

export const gitTools: Tool[] = [gitStatusTool, gitDiffTool, gitBranchTool, gitCommitTool]
