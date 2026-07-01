/**
 * apply_patch — apply several coordinated file changes in ONE call.
 *
 * Takes an ordered list of operations (create / edit / delete). All are
 * validated first; if any is invalid nothing is written (all-or-nothing), so a
 * multi-file refactor never lands half-applied. Reports every change so the
 * session snapshot can undo the whole set.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs"
import { dirname } from "node:path"

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { resolvePath } from "./fs-helpers.js"

interface Op {
  type: "create" | "edit" | "delete"
  path: string
  content?: string
  oldString?: string
  newString?: string
  replaceAll?: boolean
}

interface Planned {
  op: Op
  absolute: string
  before: string | null
  after: string | null
}

export const applyPatchTool: Tool = {
  name: "apply_patch",
  description:
    "Apply MULTIPLE coordinated file changes atomically in one call. Provide an ordered list of " +
    "operations: {type:'create',path,content}, {type:'edit',path,oldString,newString,replaceAll?}, " +
    "or {type:'delete',path}. All operations are validated first; if any fails, none are applied. " +
    "Prefer this for multi-file refactors so changes land together and can be undone as a set.",
  category: "write",
  parameters: objectSchema(
    {
      operations: {
        type: "array",
        description: "Ordered file operations to apply atomically",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["create", "edit", "delete"] },
            path: { type: "string" },
            content: { type: "string", description: "For create: full file contents" },
            oldString: { type: "string", description: "For edit: exact text to replace" },
            newString: { type: "string", description: "For edit: replacement text" },
            replaceAll: { type: "boolean", description: "For edit: replace all occurrences" },
          },
          required: ["type", "path"],
        },
      },
    },
    ["operations"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const ops = Array.isArray(args["operations"]) ? (args["operations"] as Op[]) : null
    if (!ops || ops.length === 0) return { success: false, output: "Error: 'operations' must be a non-empty array." }

    const level = ctx.permissionFor("apply_patch", ops.map((o) => `${o.type} ${o.path}`).join("; "))
    if (level === "deny") return { success: false, output: "Error: apply_patch denied by permissions." }

    // ---- Plan & validate everything first (no writes yet). ----
    const planned: Planned[] = []
    for (const op of ops) {
      if (!op || typeof op.path !== "string" || !op.path) {
        return { success: false, output: "Error: every operation needs a string 'path'." }
      }
      const { absolute, external } = resolvePath(ctx.projectRoot, op.path)
      if (external) {
        const ok = await ctx.requestApproval("apply_patch", `write outside project root: ${op.path}`, true)
        if (!ok) return { success: false, output: `Rejected: ${op.path} is outside the project root.` }
      }
      const exists = existsSync(absolute)
      const current = exists ? safeRead(absolute) : null

      if (op.type === "create") {
        if (typeof op.content !== "string") return { success: false, output: `Error: create ${op.path} needs 'content'.` }
        planned.push({ op, absolute, before: current, after: op.content })
      } else if (op.type === "delete") {
        if (!exists) return { success: false, output: `Error: delete target does not exist: ${op.path}` }
        planned.push({ op, absolute, before: current, after: null })
      } else if (op.type === "edit") {
        if (!exists || current === null) return { success: false, output: `Error: edit target not found: ${op.path}` }
        if (typeof op.oldString !== "string" || op.oldString.length === 0) {
          return { success: false, output: `Error: edit ${op.path} needs a non-empty 'oldString'.` }
        }
        const newString = typeof op.newString === "string" ? op.newString : ""
        const occurrences = current.split(op.oldString).length - 1
        if (occurrences === 0) return { success: false, output: `Error: oldString not found in ${op.path}.` }
        if (occurrences > 1 && !op.replaceAll) {
          return { success: false, output: `Error: oldString appears ${occurrences}× in ${op.path}; set replaceAll or add more context.` }
        }
        const after = op.replaceAll
          ? current.split(op.oldString).join(newString)
          : current.replace(op.oldString, newString)
        planned.push({ op, absolute, before: current, after })
      } else {
        return { success: false, output: `Error: unknown operation type "${(op as Op).type}".` }
      }
    }

    // ---- Apply (all validated). ----
    const changes: { path: string; before: string | null; after: string | null }[] = []
    const summary: string[] = []
    for (const p of planned) {
      try {
        if (p.after === null) {
          rmSync(p.absolute, { force: true })
        } else {
          mkdirSync(dirname(p.absolute), { recursive: true })
          writeFileSync(p.absolute, p.after, "utf-8")
        }
        const rel = resolvePath(ctx.projectRoot, p.op.path).relative
        changes.push({ path: rel, before: p.before, after: p.after })
        summary.push(`${p.op.type} ${rel}`)
      } catch (err) {
        return { success: false, output: `Applied ${changes.length}/${planned.length} then failed on ${p.op.path}: ${(err as Error).message}`, metadata: { changes } }
      }
    }

    ctx.report(`✎ apply_patch: ${summary.join(", ")}`)
    return {
      success: true,
      output: `Applied ${changes.length} operation(s):\n${summary.join("\n")}`,
      metadata: { changes },
    }
  },
}

function safeRead(abs: string): string | null {
  try {
    if (!statSync(abs).isFile()) return null
    return readFileSync(abs, "utf-8")
  } catch {
    return null
  }
}
