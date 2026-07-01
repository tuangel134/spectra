import { spawnSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { matchGlob } from "../util/glob.js"
import { truncate, resolvePath } from "./fs-helpers.js"

const MAX_OUTPUT = 20_000

function hasRipgrep(): boolean {
  return spawnSync("rg", ["--version"], { encoding: "utf-8" }).status === 0
}

/** Fallback recursive walk when ripgrep is unavailable. */
function walk(dir: string, root: string, acc: string[], depth = 0): void {
  if (depth > 25 || acc.length > 5000) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      walk(full, root, acc, depth + 1)
    } else {
      acc.push(relative(root, full))
    }
  }
}

export const globTool: Tool = {
  name: "glob",
  description: "Find files matching a glob pattern like **/*.ts or src/**/*.js.",
  category: "read",
  parameters: objectSchema(
    {
      pattern: { type: "string", description: "Glob pattern" },
      path: { type: "string", description: "Base directory (default: project root)" },
    },
    ["pattern"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const pattern = String(args["pattern"] ?? "")
    if (!pattern) return { success: false, output: "Error: 'pattern' is required." }

    const base = args["path"] ? String(args["path"]) : "."
    // Confine the search base to the project root.
    if (base !== "." && resolvePath(ctx.projectRoot, base).external) {
      return { success: false, output: `Error: base path escapes the project root: ${base}` }
    }

    let files: string[] = []

    if (hasRipgrep()) {
      const result = spawnSync("rg", ["--files", "--glob", pattern, base], {
        cwd: ctx.projectRoot,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      })
      if (result.status === 0 || result.status === 1) {
        files = (result.stdout || "")
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean)
      }
    } else {
      const acc: string[] = []
      walk(join(ctx.projectRoot, base), ctx.projectRoot, acc)
      files = acc.filter((f) => matchGlob(f, pattern))
    }

    if (files.length === 0) {
      return { success: true, output: "No files matched." }
    }

    return {
      success: true,
      output: truncate(files.join("\n"), MAX_OUTPUT),
      metadata: { count: files.length },
    }
  },
}
