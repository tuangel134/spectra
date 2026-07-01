/**
 * Pure layout helpers: boxes, centering, padding.
 *
 * These produce arrays of strings (rows) so the renderer can place them on the
 * screen, and so they can be unit-tested without a terminal.
 */

import { visibleWidth } from "./ansi.js"

const BORDERS = {
  sharp: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
  round: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
} as const

export type BorderStyle = keyof typeof BORDERS

/** Center a single line of text within a given width. */
export function centerLine(text: string, width: number): string {
  const w = visibleWidth(text)
  if (w >= width) return text
  const left = Math.floor((width - w) / 2)
  return " ".repeat(left) + text
}

/** Left-pad a line so its content starts at a given column offset. */
export function indent(text: string, offset: number): string {
  return " ".repeat(Math.max(0, offset)) + text
}

export interface BoxOptions {
  /** Inner width (content area), excluding borders. */
  width: number
  /** Content rows (already styled). Each is padded/truncated to width. */
  content: string[]
  /** Border style (default: round). */
  style?: BorderStyle
  /** Optional function to colorize border characters. */
  paint?: (char: string) => string
}

/** Draw a bordered box. Returns the rows including borders. */
export function drawBox(options: BoxOptions): string[] {
  const { width, content } = options
  const b = BORDERS[options.style ?? "round"]
  const paint = options.paint ?? ((c: string) => c)

  const top = paint(b.tl + b.h.repeat(width + 2) + b.tr)
  const bottom = paint(b.bl + b.h.repeat(width + 2) + b.br)
  const v = paint(b.v)

  const rows = content.map((line) => {
    const pad = Math.max(0, width - visibleWidth(line))
    return `${v} ${line}${" ".repeat(pad)} ${v}`
  })

  return [top, ...rows, bottom]
}

/** Total rendered width of a box for a given inner width. */
export function boxWidth(innerWidth: number): number {
  return innerWidth + 4 // 2 borders + 2 padding spaces
}
