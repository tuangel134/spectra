/**
 * Filesystem helpers shared by file tools.
 * Enforces that all paths stay within the project root unless explicitly allowed.
 */

import { resolve, relative, isAbsolute } from "node:path"

export interface ResolvedPath {
  /** Absolute, normalized path. */
  absolute: string
  /** Path relative to the project root. */
  relative: string
  /** True if the path escapes the project root. */
  external: boolean
}

/** Resolve a possibly-relative path against the project root. */
export function resolvePath(projectRoot: string, input: string): ResolvedPath {
  const absolute = isAbsolute(input) ? resolve(input) : resolve(projectRoot, input)
  const rel = relative(projectRoot, absolute)
  const external = rel.startsWith("..") || isAbsolute(rel)
  return { absolute, relative: rel || ".", external }
}

/** Truncate text to a maximum number of characters with an indicator. */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + `\n... [truncated ${text.length - maxChars} characters]`
}
