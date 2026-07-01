import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { resolvePath } from "./fs-helpers.js"

export const writeTool: Tool = {
  name: "write",
  description:
    "Create a new file or overwrite an existing one with the given content.",
  category: "write",
  parameters: objectSchema(
    {
      path: { type: "string", description: "File path relative to the project root" },
      content: { type: "string", description: "Full file content to write" },
    },
    ["path", "content"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const path = String(args["path"] ?? "")
    const content = String(args["content"] ?? "")
    if (!path) return { success: false, output: "Error: 'path' is required." }

    const resolved = resolvePath(ctx.projectRoot, path)

    const level = ctx.permissionFor("write", resolved.absolute)
    if (level === "deny") {
      return { success: false, output: `Error: write denied for ${path}` }
    }
    // A write that escapes the project root always requires explicit approval,
    // even when the write policy is "allow" — never silently touch outside files.
    if (resolved.external) {
      const approved = await ctx.requestApproval(
        "write",
        `Write OUTSIDE the project root: ${resolved.absolute} (${content.length} bytes)`,
        true,
      )
      if (!approved) return { success: false, output: `Write outside project (${path}) rejected.` }
    } else if (level === "ask") {
      const existed = existsSync(resolved.absolute)
      const approved = await ctx.requestApproval(
        "write",
        `${existed ? "Overwrite" : "Create"} ${resolved.relative} (${content.length} bytes)`,
      )
      if (!approved) return { success: false, output: `Write to ${path} rejected by user.` }
    }

    const existedBefore = existsSync(resolved.absolute)
    const before = existedBefore ? readFileSync(resolved.absolute, "utf-8") : null

    mkdirSync(dirname(resolved.absolute), { recursive: true })
    writeFileSync(resolved.absolute, content, "utf-8")

    ctx.report(`${existedBefore ? "Updated" : "Created"} ${resolved.relative}`)

    return {
      success: true,
      output: `${existedBefore ? "Updated" : "Created"} ${resolved.relative} (${content.length} bytes)`,
      metadata: { path: resolved.relative, before, after: content },
    }
  },
}
