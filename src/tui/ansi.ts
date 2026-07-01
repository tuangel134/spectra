/**
 * ANSI escape-code primitives for full-screen terminal rendering.
 */

export const ansi = {
  // Screen buffer
  enterAltScreen: "\x1b[?1049h",
  exitAltScreen: "\x1b[?1049l",
  clear: "\x1b[2J",
  clearLine: "\x1b[2K",

  // Cursor
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  home: "\x1b[H",

  /** Move the cursor to a 1-indexed (row, col). */
  moveTo(row: number, col: number): string {
    return `\x1b[${row};${col}H`
  },
}

/** Visible width of a string, ignoring ANSI escape sequences. */
export function visibleWidth(text: string): number {
  return stripAnsi(text).length
}

/** Remove ANSI escape sequences from a string. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
}

/** Truncate a string to a visible width, preserving a trailing reset. */
export function truncateVisible(text: string, maxWidth: number): string {
  if (visibleWidth(text) <= maxWidth) return text
  // Simple truncation on the stripped form (logo/box content is plain).
  const plain = stripAnsi(text)
  return plain.slice(0, Math.max(0, maxWidth - 1)) + "…"
}
