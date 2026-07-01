import { spawnSync } from "node:child_process"

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { truncate, resolvePath } from "./fs-helpers.js"

const MAX_OUTPUT = 40_000

/** Detect whether ripgrep is available on the system. */
function hasRipgrep(): boolean {
  const result = spawnSync("rg", ["--version"], { encoding: "utf-8" })
  return result.status === 0
}

export const grepTool: Tool = {
  name: "grep",
  description:
    "Search file contents using a regular expression. Uses ripgrep when available.",
  category: "read",
  parameters: objectSchema(
    {
      pattern: { type: "string", description: "Regex pattern to search for" },
      path: { type: "string", description: "Directory or file to search (default: project root)" },
      include: { type: "string", description: "Glob of files to include, e.g. **/*.ts" },
      caseSensitive: { type: "boolean", description: "Case-sensitive search" },
    },
    ["pattern"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const pattern = String(args["pattern"] ?? "")
    if (!pattern) return { success: false, output: "Error: 'pattern' is required." }

    const searchPath = args["path"] ? String(args["path"]) : "."
    const include = args["include"] ? String(args["include"]) : undefined
    const caseSensitive = Boolean(args["caseSensitive"])
    // Confine the search path to the project root.
    if (searchPath !== "." && resolvePath(ctx.projectRoot, searchPath).external) {
      return { success: false, output: `Error: search path escapes the project root: ${searchPath}` }
    }

    if (!hasRipgrep()) {
      return {
        success: false,
        output: "Error: ripgrep (rg) is not installed. Install it to use grep.",
      }
    }

    const rgArgs = ["--line-number", "--no-heading", "--color", "never", "--max-count", "50"]
    if (!caseSensitive) rgArgs.push("--ignore-case")
    if (include) rgArgs.push("--glob", include)
    rgArgs.push(pattern, searchPath)

    const result = spawnSync("rg", rgArgs, {
      cwd: ctx.projectRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    })

    // rg exit code 1 means "no matches", which is not an error for us.
    if (result.status === 1) {
      return { success: true, output: "No matches found." }
    }
    if (result.status !== 0) {
      return {
        success: false,
        output: `grep failed: ${result.stderr || "unknown error"}`,
      }
    }

    return {
      success: true,
      output: truncate(result.stdout || "No matches found.", MAX_OUTPUT),
    }
  },
}
