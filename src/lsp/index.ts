/**
 * LSP module — diagnostics tool + exports.
 */

import { resolve, isAbsolute, relative } from "node:path"

import type { Tool, ToolContext, ToolResult } from "../tool/types.js"
import { objectSchema } from "../tool/types.js"
import { LspManager, languageForFile, type Diagnostic } from "./manager.js"

export { LspClient, type Diagnostic, type LspServerSpec } from "./client.js"
export { LspManager, languageForFile, type DiagnoseResult } from "./manager.js"

/** Format diagnostics as compact, agent-readable lines. */
export function formatDiagnostics(file: string, diags: Diagnostic[]): string {
  if (diags.length === 0) return `${file}: no diagnostics ✓`
  const lines = diags
    .sort((a, b) => a.line - b.line)
    .map((d) => `  ${d.severity.toUpperCase()} ${file}:${d.line}:${d.column}  ${d.message}${d.code ? ` [${d.code}]` : ""}`)
  return `${file}: ${diags.length} issue(s)\n${lines.join("\n")}`
}

/** Build the `diagnostics` tool bound to an LSP manager. */
export function createDiagnosticsTool(manager: LspManager, projectRoot: string): Tool {
  return {
    name: "diagnostics",
    description:
      "Get language-server diagnostics (type errors, lint, warnings) for a source file. " +
      "Use after editing to confirm the file has no errors before moving on.",
    category: "read",
    availableToSubagents: true,
    parameters: objectSchema(
      { path: { type: "string", description: "File path (relative to the project root)" } },
      ["path"],
    ),
    async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const rel = String(args["path"] ?? "")
      if (!rel) return { success: false, output: "Error: 'path' is required." }
      const abs = isAbsolute(rel) ? rel : resolve(projectRoot, rel)

      if (!languageForFile(abs)) {
        return { success: true, output: `No language server configured for ${rel} (unsupported file type).` }
      }
      const result = await manager.diagnose(abs)
      if (result.unsupported) return { success: true, output: `Unsupported file type: ${rel}` }
      if (result.missing) {
        return {
          success: false,
          output:
            `No diagnostics: language server "${result.missing}" is not installed.\n` +
            "Install it (e.g. npm i -g typescript-language-server typescript) to enable live diagnostics.",
        }
      }
      const display = isAbsolute(rel) ? relative(projectRoot, abs) : rel
      const errors = result.diagnostics.filter((d) => d.severity === "error").length
      return {
        success: errors === 0,
        output: formatDiagnostics(display, result.diagnostics),
        metadata: { errors, total: result.diagnostics.length },
      }
    },
  }
}
