import { readFileSync, existsSync, statSync } from "node:fs"

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { resolvePath, truncate } from "./fs-helpers.js"
import { compressJson } from "../headroom/json.js"

const MAX_OUTPUT = 60_000

export const readTool: Tool = {
  name: "read",
  description:
    "Read the contents of a file. Optionally restrict to a line range for large files.",
  category: "read",
  parameters: objectSchema(
    {
      path: { type: "string", description: "File path relative to the project root" },
      startLine: { type: "number", description: "1-indexed first line to read" },
      endLine: { type: "number", description: "1-indexed last line to read" },
    },
    ["path"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const path = String(args["path"] ?? "")
    if (!path) return { success: false, output: "Error: 'path' is required." }

    const resolved = resolvePath(ctx.projectRoot, path)
    if (resolved.external) {
      const level = ctx.permissionFor("read", resolved.absolute)
      if (level === "deny") {
        return { success: false, output: `Error: reading outside project denied: ${path}` }
      }
      if (level === "ask") {
        const approved = await ctx.requestApproval("read", `Read OUTSIDE the project root: ${resolved.absolute}`, true)
        if (!approved) return { success: false, output: `Read outside project (${path}) rejected.` }
      }
    }

    if (!existsSync(resolved.absolute)) {
      return { success: false, output: `Error: file not found: ${path}` }
    }

    const stat = statSync(resolved.absolute)
    if (stat.isDirectory()) {
      return { success: false, output: `Error: ${path} is a directory, not a file.` }
    }

    let content = readFileSync(resolved.absolute, "utf-8")

    const startLine = args["startLine"] ? Number(args["startLine"]) : undefined
    const endLine = args["endLine"] ? Number(args["endLine"]) : undefined

    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split("\n")
      const start = (startLine ?? 1) - 1
      const end = endLine ?? lines.length
      content = lines.slice(start, end).join("\n")
    }

    // For oversized files, plain truncation would feed the model an incomplete
    // (and, for JSON, syntactically broken) slice. If the whole file is a
    // structured JSON payload, collapse it into a compact columnar view that
    // keeps EVERY row (lossless in content — just de-duplicated keys and
    // stripped whitespace), so the model sees ALL the data in far fewer tokens.
    if (content.length > MAX_OUTPUT) {
      const c = compressJson(content, { headRows: Number.MAX_SAFE_INTEGER, tailRows: 0 })
      if (c.changed && c.text.length < content.length) {
        const note =
          c.text.length > MAX_OUTPUT
            ? `\n[still large after compression — showing the first part; re-read with startLine/endLine for any specific range]`
            : ""
        return {
          success: true,
          output: `[large file shown in compact columnar form — all rows preserved, keys de-duplicated]\n${truncate(c.text, MAX_OUTPUT)}${note}`,
          metadata: { path: resolved.relative, bytes: stat.size, compressed: true },
        }
      }
    }

    return {
      success: true,
      output: truncate(content, MAX_OUTPUT),
      metadata: { path: resolved.relative, bytes: stat.size },
    }
  },
}
