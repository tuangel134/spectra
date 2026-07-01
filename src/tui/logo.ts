/**
 * The Spectra wordmark, rendered as block ASCII art.
 */

export const LOGO_LINES: string[] = [
  "███████ ██████  ███████  ██████ ████████ ██████   █████ ",
  "██      ██   ██ ██      ██         ██    ██   ██ ██   ██ ",
  "███████ ██████  █████   ██         ██    ██████  ███████ ",
  "     ██ ██      ██      ██         ██    ██   ██ ██   ██ ",
  "███████ ██      ███████  ██████    ██    ██   ██ ██   ██ ",
]

/** Compact one-line mark for very small terminals. */
export const LOGO_COMPACT = "⚡ S P E C T R A"

export const LOGO_WIDTH = Math.max(...LOGO_LINES.map((l) => l.length))
