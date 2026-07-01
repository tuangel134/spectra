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

/** Remove ANSI escape sequences from a string. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
}

/**
 * Display width of a single code point (a wcwidth approximation):
 *   0 for combining marks / zero-width joiners / variation selectors,
 *   2 for wide East-Asian glyphs and emoji,
 *   1 otherwise.
 */
export function charWidth(cp: number): number {
  if (cp === 0) return 0
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0 // control
  // Zero-width: combining marks, ZWJ/ZWNJ, variation selectors, BOM.
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff
  )
    return 0
  // Wide / fullwidth / emoji.
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals … symbols
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana … CJK compat
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji & pictographs
    (cp >= 0x2600 && cp <= 0x27bf) || // misc symbols & dingbats
    (cp >= 0x1f000 && cp <= 0x1f0ff) || // tiles/cards
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK ext B+
  )
    return 2
  return 1
}

/** Visible width of a string, ignoring ANSI escapes and honoring wide glyphs. */
export function visibleWidth(text: string): number {
  let w = 0
  for (const ch of stripAnsi(text)) w += charWidth(ch.codePointAt(0)!)
  return w
}

/** Truncate a string to a visible width, appending an ellipsis when clipped. */
export function truncateVisible(text: string, maxWidth: number): string {
  if (visibleWidth(text) <= maxWidth) return text
  const plain = stripAnsi(text)
  let out = ""
  let w = 0
  for (const ch of plain) {
    const cw = charWidth(ch.codePointAt(0)!)
    if (w + cw > Math.max(0, maxWidth - 1)) break
    out += ch
    w += cw
  }
  return out + "…"
}
