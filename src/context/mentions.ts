/**
 * @file mentions.
 *
 * When a user types `@path/to/file` in their message, inline that file's
 * contents as context so the agent can see it without a separate read. Bounded
 * in size and confined to the project root (no path traversal).
 */

import { readFileSync, statSync } from "node:fs"
import { resolve, relative, isAbsolute, sep } from "node:path"

const MAX_FILE_BYTES = 60_000
const MAX_TOTAL_BYTES = 200_000

/**
 * Expand `@file` tokens in `text` by appending the referenced files' contents.
 * Missing, oversized, binary, or out-of-root paths are silently skipped.
 */
export function expandFileMentions(text: string, projectRoot: string): string {
  const tokens = [...text.matchAll(/(?:^|\s)@([^\s]+)/g)].map((m) => m[1]!)
  if (tokens.length === 0) return text

  const seen = new Set<string>()
  const blocks: string[] = []
  let total = 0

  for (const token of tokens) {
    const rel = token.replace(/[.,;:)\]]+$/, "") // strip trailing punctuation
    if (!rel || seen.has(rel)) continue
    seen.add(rel)

    const abs = resolve(projectRoot, rel)
    const within = relative(projectRoot, abs)
    // Reject only real traversal (a ".." path SEGMENT) or absolute paths — not
    // legitimate in-root files whose name merely starts with ".." (e.g. "..env").
    if (within === ".." || within.startsWith(".." + sep) || isAbsolute(within)) continue

    try {
      const st = statSync(abs)
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue
      const content = readFileSync(abs, "utf-8")
      // Skip likely-binary files (NUL byte in first chunk).
      if (content.slice(0, 4000).includes("\u0000")) continue
      if (total + content.length > MAX_TOTAL_BYTES) break
      total += content.length
      blocks.push(`=== ${rel} ===\n${content}`)
    } catch {
      /* missing or unreadable — skip */
    }
  }

  if (blocks.length === 0) return text
  return `${text}\n\n[Referenced files]\n${blocks.join("\n\n")}`
}
