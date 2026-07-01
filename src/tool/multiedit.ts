/**
 * multiedit — apply several string replacements to ONE file atomically.
 *
 * Like calling `edit` multiple times, but all edits are applied in order to an
 * in-memory copy and written once (all-or-nothing). Keeps single-file snapshot
 * semantics so undo still works. Ideal for coordinated changes within a file
 * (e.g. rename a symbol at several call sites) without repeated round-trips.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { resolvePath } from "./fs-helpers.js"

interface EditOp {
  oldStr: string
  newStr: string
  replaceAll?: boolean
}

export const multiEditTool: Tool = {
  name: "multiedit",
  description:
    "Apply MULTIPLE exact-string replacements to a single file in one atomic operation. " +
    "Pass `path` and an `edits` array of {oldStr, newStr, replaceAll?}. Edits apply in order; " +
    "each oldStr must match (uniquely unless replaceAll). Nothing is written if any edit fails.",
  category: "write",
  parameters: objectSchema(
    {
      path: { type: "string", description: "File path relative to the project root" },
      edits: {
        type: "array",
        description: "Edits applied in order",
        items: {
          type: "object",
          properties: {
            oldStr: { type: "string", description: "Exact text to find" },
            newStr: { type: "string", description: "Replacement text" },
            replaceAll: { type: "boolean", description: "Replace all occurrences" },
          },
          required: ["oldStr", "newStr"],
        },
      },
    },
    ["path", "edits"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const path = String(args["path"] ?? "")
    const rawEdits = Array.isArray(args["edits"]) ? (args["edits"] as Record<string, unknown>[]) : null
    if (!path) return { success: false, output: "Error: 'path' is required." }
    if (!rawEdits || rawEdits.length === 0) return { success: false, output: "Error: 'edits' must be a non-empty array." }

    const edits: EditOp[] = rawEdits.map((e) => ({
      oldStr: String(e["oldStr"] ?? ""),
      newStr: String(e["newStr"] ?? ""),
      replaceAll: Boolean(e["replaceAll"]),
    }))

    const resolved = resolvePath(ctx.projectRoot, path)
    if (!existsSync(resolved.absolute)) return { success: false, output: `Error: file not found: ${path}` }

    const level = ctx.permissionFor("edit", resolved.absolute)
    if (level === "deny") return { success: false, output: `Error: edit denied for ${path}` }

    const before = readFileSync(resolved.absolute, "utf-8")
    let current = before
    let applied = 0

    for (let i = 0; i < edits.length; i++) {
      const { oldStr, newStr, replaceAll } = edits[i]!
      if (oldStr === "") return { success: false, output: `Error: edit #${i + 1} has an empty oldStr.` }
      if (oldStr === newStr) continue // no-op
      if (!current.includes(oldStr)) {
        return { success: false, output: `Error: edit #${i + 1} oldStr not found (after prior edits). Nothing written.` }
      }
      const occurrences = current.split(oldStr).length - 1
      if (!replaceAll && occurrences > 1) {
        return {
          success: false,
          output: `Error: edit #${i + 1} oldStr matches ${occurrences} times. Add context or set replaceAll. Nothing written.`,
        }
      }
      current = replaceAll
        ? current.split(oldStr).join(newStr)
        : (() => {
            const idx = current.indexOf(oldStr)
            return current.slice(0, idx) + newStr + current.slice(idx + oldStr.length)
          })()
      applied++
    }

    if (current === before) {
      return { success: true, output: `No changes (edits were no-ops) for ${resolved.relative}.` }
    }

    // Escaping the project root is a hard, always-on approval gate.
    if (resolved.external) {
      const ok = await ctx.requestApproval("edit", `Edit OUTSIDE the project root: ${resolved.absolute}`, true)
      if (!ok) return { success: false, output: `Edit outside project (${path}) rejected.` }
    } else if (level === "ask") {
      const ok = await ctx.requestApproval("edit", `Apply ${applied} edit(s) to ${resolved.relative}`)
      if (!ok) return { success: false, output: `Edits to ${path} rejected by user.` }
    }

    writeFileSync(resolved.absolute, current, "utf-8")
    ctx.report(`Multi-edited ${resolved.relative} (${applied} edit${applied > 1 ? "s" : ""})`)

    return {
      success: true,
      output: `Applied ${applied} edit(s) to ${resolved.relative}.`,
      metadata: { path: resolved.relative, before, after: current },
    }
  },
}
