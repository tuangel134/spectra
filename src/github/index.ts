/**
 * GitHub integration.
 *
 * "Push to GitHub" — the agent generates a professional README and CI config,
 * creates a repo via the GitHub API, and pushes the project. All automated.
 *
 * Requires a GitHub personal access token stored in the config or via
 * GITHUB_TOKEN env var (set it in Config → GitHub).
 */

import { spawn } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { join, basename } from "node:path"

export interface GitHubConfig {
  token: string
  username?: string
  /** Make repos private by default? */
  private?: boolean
}

interface GitRun {
  code: number
  stdout: string
  stderr: string
}

function git(args: string[], cwd: string): Promise<GitRun> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, env: process.env })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()))
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()))
    child.on("error", (err) => resolve({ code: 127, stdout, stderr: err.message }))
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

/** Detect the GitHub username from the token via the API. */
export async function getUsername(token: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { login?: string }
    return data.login ?? null
  } catch {
    return null
  }
}

/** Create a GitHub repo via the API. Returns the clone URL or null on failure. */
export async function createRepo(
  token: string,
  name: string,
  description: string,
  isPrivate: boolean,
): Promise<{ cloneUrl: string; htmlUrl: string } | { error: string }> {
  try {
    const res = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, description, private: isPrivate, auto_init: false }),
    })
    const data = (await res.json()) as { clone_url?: string; html_url?: string; message?: string; errors?: { message: string }[] }
    if (res.status === 201 && data.clone_url) {
      return { cloneUrl: data.clone_url, htmlUrl: data.html_url ?? "" }
    }
    // Repo may already exist — try getting it.
    if (res.status === 422 && data.errors?.some((e) => /already exists/i.test(e.message))) {
      const user = await getUsername(token)
      if (user) {
        return {
          cloneUrl: `https://github.com/${user}/${name}.git`,
          htmlUrl: `https://github.com/${user}/${name}`,
        }
      }
    }
    return { error: data.message ?? `GitHub API ${res.status}` }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export interface PushResult {
  ok: boolean
  repoUrl?: string
  error?: string
  steps: string[]
}

/**
 * Full "Push to GitHub" flow:
 *   1. Ensure git is initialized.
 *   2. Write CI file if missing.
 *   3. Stage all, commit.
 *   4. Create repo via API.
 *   5. Set remote and push.
 */
export async function pushToGitHub(
  projectRoot: string,
  config: GitHubConfig,
  description?: string,
): Promise<PushResult> {
  const steps: string[] = []
  const name = basename(projectRoot)
  const token = config.token || process.env["GITHUB_TOKEN"] || ""
  if (!token) return { ok: false, error: "No GitHub token configured. Set it in Config → GitHub.", steps }

  // 1. Git init if needed.
  if (!existsSync(join(projectRoot, ".git"))) {
    await git(["init", "-q"], projectRoot)
    steps.push("Initialized git repository.")
  }

  // 2. Write CI if missing.
  const ciPath = join(projectRoot, ".github", "workflows", "ci.yml")
  if (!existsSync(ciPath)) {
    const { mkdirSync } = await import("node:fs")
    mkdirSync(join(projectRoot, ".github", "workflows"), { recursive: true })
    writeFileSync(ciPath, defaultCI(name))
    steps.push("Created .github/workflows/ci.yml")
  }

  // 3. Write .gitignore if missing.
  if (!existsSync(join(projectRoot, ".gitignore"))) {
    writeFileSync(join(projectRoot, ".gitignore"), "node_modules/\ndist/\n.env\n")
    steps.push("Created .gitignore")
  }

  // 4. Stage and commit.
  await git(["add", "-A"], projectRoot)
  const status = await git(["status", "--porcelain"], projectRoot)
  if (status.stdout.trim()) {
    await git(["commit", "-m", "feat: initial commit via Spectra"], projectRoot)
    steps.push("Committed all changes.")
  } else {
    steps.push("Working tree clean, nothing to commit.")
  }

  // 5. Create repo.
  const repoResult = await createRepo(token, name, description ?? `${name} — built with Spectra`, config.private ?? false)
  if ("error" in repoResult) return { ok: false, error: repoResult.error, steps }
  steps.push(`Repo: ${repoResult.htmlUrl}`)

  // 6. Set remote + push.
  const cloneUrl = repoResult.cloneUrl.replace("https://", `https://${token}@`)
  const tokenlessUrl = repoResult.cloneUrl
  await git(["remote", "remove", "origin"], projectRoot).catch(() => {})
  await git(["remote", "add", "origin", cloneUrl], projectRoot)
  const branch = (await git(["branch", "--show-current"], projectRoot)).stdout.trim() || "main"
  if (branch !== "main") await git(["branch", "-M", "main"], projectRoot)
  // Plain push (never --force): pushing over a pre-existing repo with different
  // history must fail loudly, not silently destroy the remote's contents.
  const push = await git(["push", "-u", "origin", "main"], projectRoot)
  // Scrub the embedded token from git config so it isn't persisted in plaintext.
  await git(["remote", "set-url", "origin", tokenlessUrl], projectRoot).catch(() => {})
  const scrub = (s: string): string => s.split(token).join("***")
  if (push.code !== 0) {
    const reason = /\b(rejected|non-fast-forward|fetch first|Updates were rejected)\b/i.test(push.stderr)
      ? "the remote repo already has commits. Push was rejected to avoid overwriting it. Use a new repo name or reconcile manually."
      : scrub(push.stderr) || "git push failed"
    return { ok: false, error: reason, steps }
  }
  steps.push("Pushed to GitHub ✓")

  return { ok: true, repoUrl: repoResult.htmlUrl, steps }
}

function defaultCI(_projectName: string): string {
  return `name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test
`
}

/** Generate a professional README for a project (called by the agent or the push flow). */
export function generateReadmePrompt(name: string, description: string): string {
  return [
    `Generate a complete, professional README.md for a project named "${name}".`,
    `Description: ${description}`,
    ``,
    `Include these sections with proper formatting and badges:`,
    `- Header with project name and one-line description`,
    `- Badges (CI status, license, version)`,
    `- Features (bulleted list)`,
    `- Quick start (install + usage)`,
    `- Architecture / Project structure`,
    `- Configuration`,
    `- Contributing`,
    `- License (MIT)`,
    ``,
    `Make it look polished and complete. Use emojis sparingly. Write it directly as markdown.`,
  ].join("\n")
}
