import { readFileSync, writeFileSync, existsSync } from "node:fs"

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { resolvePath } from "./fs-helpers.js"

export const editTool: Tool = {
  name: "edit",
  description:
    "Edit a file by replacing an exact string. The oldStr must match exactly once unless replaceAll is set.",
  category: "write",
  parameters: objectSchema(
    {
      path: { type: "string", description: "File path relative to the project root" },
      oldStr: { type: "string", description: "Exact text to find" },
      newStr: { type: "string", description: "Replacement text" },
      replaceAll: {
        type: "boolean",
        description: "Replace all occurrences instead of requiring a unique match",
      },
    },
    ["path", "oldStr", "newStr"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const path = String(args["path"] ?? "")
    const oldStr = String(args["oldStr"] ?? "")
    const newStr = String(args["newStr"] ?? "")
    const replaceAll = Boolean(args["replaceAll"])

    if (!path) return { success: false, output: "Error: 'path' is required." }
    if (oldStr === "") {
      return { success: false, output: "Error: oldStr must not be empty." }
    }
    if (oldStr === newStr) {
      return { success: false, output: "Error: oldStr and newStr are identical." }
    }

    const resolved = resolvePath(ctx.projectRoot, path)
    if (!existsSync(resolved.absolute)) {
      return { success: false, output: `Error: file not found: ${path}` }
    }

    const level = ctx.permissionFor("edit", resolved.absolute)
    if (level === "deny") {
      return { success: false, output: `Error: edit denied for ${path}` }
    }

    const before = readFileSync(resolved.absolute, "utf-8")

    if (!before.includes(oldStr)) {
      return {
        success: false,
        output: `Error: oldStr not found in ${path}. Make sure it matches exactly.`,
      }
    }

    const occurrences = before.split(oldStr).length - 1
    if (!replaceAll && occurrences > 1) {
      return {
        success: false,
        output: `Error: oldStr matches ${occurrences} times in ${path}. Provide more context or set replaceAll.`,
      }
    }

    // Edits that escape the project root always require explicit approval.
    if (resolved.external) {
      const approved = await ctx.requestApproval("edit", `Edit OUTSIDE the project root: ${resolved.absolute}`, true)
      if (!approved) return { success: false, output: `Edit outside project (${path}) rejected.` }
    } else if (level === "ask") {
      const approved = await ctx.requestApproval(
        "edit",
        `Edit ${resolved.relative} (${occurrences} replacement${occurrences > 1 ? "s" : ""})`,
      )
      if (!approved) return { success: false, output: `Edit to ${path} rejected by user.` }
    }

    // Replace via split/join (never String.replace) so `$&`, `$1`, etc. in
    // newStr are inserted literally instead of being interpreted as patterns.
    const after = replaceAll
      ? before.split(oldStr).join(newStr)
      : (() => {
          const idx = before.indexOf(oldStr)
          return before.slice(0, idx) + newStr + before.slice(idx + oldStr.length)
        })()

    writeFileSync(resolved.absolute, after, "utf-8")
    ctx.report(`Edited ${resolved.relative}`)

    return {
      success: true,
      output: `Edited ${resolved.relative} (${replaceAll ? occurrences : 1} replacement${(replaceAll ? occurrences : 1) > 1 ? "s" : ""}).`,
      metadata: { path: resolved.relative, before, after },
    }
  },
}
