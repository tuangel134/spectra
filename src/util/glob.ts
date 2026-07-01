/**
 * Lightweight glob and wildcard matching utilities.
 *
 * Supports:
 *   *   matches any sequence of characters except path separator
 *   **  matches any sequence including path separators
 *   ?   matches a single character
 */

/** Convert a glob pattern into a RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let re = ""
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]

    if (char === "*") {
      // Look ahead for **
      if (pattern[i + 1] === "*") {
        // ** matches across path separators
        re += ".*"
        i += 2
        // Skip a following slash so "**/foo" matches "foo"
        if (pattern[i] === "/") i += 1
        continue
      }
      re += "[^/]*"
      i += 1
      continue
    }

    if (char === "?") {
      re += "[^/]"
      i += 1
      continue
    }

    // Escape regex special characters
    if (".+^${}()|[]\\".includes(char!)) {
      re += "\\" + char
    } else {
      re += char
    }
    i += 1
  }

  return new RegExp(`^${re}$`)
}

/** Test whether a path matches a glob pattern. */
export function matchGlob(path: string, pattern: string): boolean {
  if (pattern === "*" || pattern === "**") return true
  return globToRegExp(pattern).test(path)
}

/** Test a path against any of several glob patterns. */
export function matchAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some((p) => matchGlob(path, p))
}

/**
 * Simple wildcard matching for command/tool names.
 * Treats `*` as matching any sequence including separators.
 */
export function matchWildcard(value: string, pattern: string): boolean {
  if (pattern === "*") return true
  let re = ""
  for (const char of pattern) {
    if (char === "*") {
      re += ".*"
    } else if (".+^${}()|[]\\?".includes(char)) {
      re += "\\" + char
    } else {
      re += char
    }
  }
  return new RegExp(`^${re}$`).test(value)
}
