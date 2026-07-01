/**
 * Minimal, safe Markdown rendering for the TUI chat.
 *
 * Full syntax highlighting is out of scope; this focuses on the things that
 * make agent output readable in a terminal: framed fenced code blocks, styled
 * headers, and bullets. Only line-level prefixes are colored (content stays
 * plain) so ANSI codes never bleed across a wrapped line.
 */

import { color } from "../util/logger.js"
import { accent, type Theme } from "./theme.js"
import { visibleWidth, truncateVisible } from "./ansi.js"

/** Word-wrap a single logical line (no newlines) to a visible width. */
function wrapLine(text: string, width: number): string[] {
  if (visibleWidth(text) <= width) return [text]
  const out: string[] = []
  let line = ""
  for (const word of text.split(" ")) {
    if (line && visibleWidth(line) + visibleWidth(word) + 1 > width) {
      out.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) out.push(line)
  return out.length ? out : [""]
}

/** Render Markdown-ish text into styled terminal lines fitting `width`. */
export function renderMarkdown(text: string, width: number, theme: Theme): string[] {
  const out: string[] = []
  let inCode = false

  for (const raw of text.split("\n")) {
    const trimmed = raw.trimStart()

    // Fenced code block toggle.
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim()
      if (!inCode) {
        inCode = true
        out.push(accent(theme, "  ┌ ") + color.gray(lang || "code"))
      } else {
        inCode = false
        out.push(accent(theme, "  └"))
      }
      continue
    }

    // Inside a code block: gutter + dim, single line (truncate, never wrap).
    if (inCode) {
      const avail = Math.max(4, width - 4)
      const shown = visibleWidth(raw) > avail ? truncateVisible(raw, avail) : raw
      out.push(accent(theme, "  │ ") + color.gray(shown))
      continue
    }

    // Headers: bold + accent, truncated (headers are short).
    const header = /^(#{1,6})\s+(.+)$/.exec(raw)
    if (header) {
      out.push(color.bold(accent(theme, truncateVisible(header[2]!, width))))
      continue
    }

    // Bullets: colored marker, wrapped content indented under it.
    const bullet = /^(\s*)([-*])\s+(.+)$/.exec(raw)
    if (bullet) {
      const wrapped = wrapLine(bullet[3]!, Math.max(4, width - 2))
      out.push(accent(theme, "• ") + (wrapped[0] ?? ""))
      for (const cont of wrapped.slice(1)) out.push("  " + cont)
      continue
    }

    // Numbered lists: keep the number, wrap the rest under it.
    const numbered = /^(\s*)(\d{1,3})[.)]\s+(.+)$/.exec(raw)
    if (numbered) {
      const marker = `${numbered[2]}. `
      const wrapped = wrapLine(numbered[3]!, Math.max(4, width - marker.length))
      out.push(accent(theme, marker) + (wrapped[0] ?? ""))
      for (const cont of wrapped.slice(1)) out.push(" ".repeat(marker.length) + cont)
      continue
    }

    // Plain prose.
    for (const l of wrapLine(raw, width)) out.push(l)
  }

  return out
}
