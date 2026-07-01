/**
 * headroom_retrieve — recover an original payload that Headroom compressed.
 *
 * When a tool result is compressed, Headroom appends a reference id. If the
 * model needs the full, uncompressed content (e.g. an exact value that the
 * summary elided), it calls this tool with that ref. This is the "reversible"
 * half of CCR (compress-cache-retrieve).
 */

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"

export const headroomRetrieveTool: Tool = {
  name: "headroom_retrieve",
  description:
    "Retrieve the full, original uncompressed content for a Headroom reference id " +
    '(shown as ⟨headroom⟩ ... ref "hr_..."). Use only when the compressed summary ' +
    "is missing a detail you need.",
  category: "meta",
  availableToSubagents: true,
  parameters: objectSchema(
    {
      ref: { type: "string", description: 'The Headroom reference id, e.g. "hr_..."' },
    },
    ["ref"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const ref = String(args["ref"] ?? "").trim()
    if (!ref) return { success: false, output: "Error: 'ref' is required." }

    if (!ctx.headroom) {
      return { success: false, output: "Error: Headroom is not enabled in this session." }
    }

    const original = ctx.headroom.retrieve(ref)
    if (original === undefined) {
      return {
        success: false,
        output: `Error: no cached original found for ref "${ref}" (it may have expired).`,
      }
    }

    return { success: true, output: original, metadata: { ref, bytes: original.length } }
  },
}
