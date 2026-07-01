/**
 * Pure layout composition.
 *
 * Builds the full-screen frame (an array of `rows` lines, each `cols` wide) for
 * each view state. No terminal side effects, so it can be unit-tested.
 *
 * Spectra's chrome is intentionally distinct from minimalist terminal agents:
 * a filled header bar, a titled "get started" panel on the welcome screen, a
 * composer with a spectrum-tinted border, and a footer status bar.
 */

import { color } from "../util/logger.js"
import { visibleWidth } from "./ansi.js"
import { renderMarkdown } from "./markdown.js"
import { centerLine, indent, drawBox, boxWidth } from "./box.js"
import { LOGO_LINES, LOGO_COMPACT, LOGO_WIDTH } from "./logo.js"
import {
  getTheme,
  spectrumBar,
  spectrumAt,
  accent,
  bg,
  darken,
  type Theme,
} from "./theme.js"

export interface RenderMessage {
  role: "user" | "assistant" | "tool" | "system"
  text: string
}

export interface ViewState {
  cols: number
  rows: number
  mode: "welcome" | "chat"
  agent: string
  model: string
  connected: boolean
  input: string
  messages: RenderMessage[]
  busy: boolean
  status?: string
  prompt?: string
  mask?: boolean
  theme?: string
  tokens?: { input: number; output: number }
  /** Estimated USD cost of this session so far. */
  cost?: number
  /** Active slash-command menu (shown when typing "/"). */
  menu?: { items: { command: string; description: string; args?: string }[]; index: number }
  version: string
}

const PLACEHOLDER = 'Describe a task, or "/" commands · "@" files · "!" shell'
const MAX_BOX_INNER = 70

function inputInnerWidth(cols: number): number {
  const ideal = Math.min(MAX_BOX_INNER, cols - 6)
  // Never let the box (inner + 2 borders) exceed the terminal width, but keep a
  // usable minimum so a very narrow window still renders a box.
  return Math.max(8, Math.min(ideal, cols - 2))
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function padTo(text: string, width: number): string {
  const w = visibleWidth(text)
  return w >= width ? text : text + " ".repeat(width - w)
}

function padFrame(lines: string[], rows: number): string[] {
  const frame = [...lines]
  while (frame.length < rows) frame.push("")
  return frame.slice(0, rows)
}

/** Full-width filled header bar: brand on the left, model on the right. */
function headerBar(state: ViewState, theme: Theme): string {
  const barBg = darken(theme.accent, 0.35)
  const fg: [number, number, number] = [245, 245, 245]
  const brand = " ◆ SPECTRA "
  const right = ` ${state.agent} · ${state.model} `
  const gap = Math.max(1, state.cols - visibleWidth(brand) - visibleWidth(right))
  const line = brand + " ".repeat(gap) + right
  // Brand chip uses the accent as background for emphasis.
  const chip = bg(theme.accent, [20, 20, 20], " ◆ SPECTRA ")
  const rest = bg(barBg, fg, " ".repeat(gap) + right)
  void line
  return chip + rest
}

/** Full-width footer status bar. */
function footerBar(state: ViewState, theme: Theme): string {
  const barBg = darken(theme.accent, 0.22)
  const fg: [number, number, number] = [200, 200, 200]
  const tok = state.tokens ? `${state.tokens.input}↑ ${state.tokens.output}↓` : "0↑ 0↓"
  const cost = state.cost && state.cost >= 0.00005 ? ` · $${state.cost.toFixed(4)}` : ""
  const mode = state.connected ? "● ready" : "○ offline"
  const left = ` ${mode}`
  const right = `${tok}${cost} · v${state.version} `
  const gap = Math.max(1, state.cols - visibleWidth(left) - visibleWidth(right))
  return bg(barBg, fg, padTo(left + " ".repeat(gap) + right, state.cols))
}

/** The composer: the input box with a spectrum-tinted rounded border. */
function composer(state: ViewState, theme: Theme): string[] {
  const inner = inputInnerWidth(state.cols)
  const cursor = state.busy ? "" : accent(theme, "▏")
  const placeholder = state.prompt ?? PLACEHOLDER
  const display = state.mask && state.input.length > 0 ? "•".repeat(state.input.length) : state.input
  const firstLine = display.length > 0 ? display + cursor : color.gray(placeholder)

  const badge = accent(theme, `◆ ${capitalize(state.agent)}`)
  const meta = state.busy
    ? color.yellow("● working…")
    : state.prompt
      ? color.yellow("● awaiting input · Esc to cancel")
      : `${badge} ${color.gray("·")} ${color.gray(state.model)}`

  return drawBox({
    width: inner,
    style: "round",
    paint: (c) => accent(theme, c),
    content: [firstLine, meta],
  })
}

/** A titled panel (bordered box with a label on the top border). */
function panel(title: string, lines: string[], innerWidth: number, theme: Theme): string[] {
  const box = drawBox({
    width: innerWidth,
    style: "round",
    paint: (c) => accent(theme, c),
    content: lines,
  })
  // Inject the title into the top border.
  const top = box[0]!
  const label = accent(theme, ` ${title} `)
  // Replace a slice of the top border after the corner with the label.
  const plainTop = top // already colored; rebuild a titled top instead.
  void plainTop
  const titled = accent(theme, "╭─") + label + accent(theme, "─".repeat(Math.max(0, innerWidth + 2 - 2 - visibleWidth(label))) + "╮")
  box[0] = titled
  return box
}

function paintLogo(lines: string[], theme: Theme): string[] {
  return lines.map((line, i) => spectrumAt(theme, i / Math.max(1, lines.length - 1), line))
}

/** Render the slash-command menu (shown above the composer when typing "/"). */
function menuLines(state: ViewState, theme: Theme): string[] {
  if (!state.menu || state.menu.items.length === 0) return []
  const out: string[] = [color.dim("  ✦ commands · ↑↓ navigate · tab complete · esc dismiss")]
  state.menu.items.slice(0, 8).forEach((item, i) => {
    const active = i === state.menu!.index
    const marker = active ? accent(theme, "▸ ") : "  "
    const cmd = active ? accent(theme, item.command.padEnd(14)) : color.gray(item.command.padEnd(14))
    const desc = color.dim(item.description)
    out.push(`  ${marker}${cmd} ${desc}`)
  })
  return out
}

/** Compose the welcome screen with header chrome and a get-started panel. */
export function renderWelcome(state: ViewState): string[] {
  const theme = getTheme(state.theme)
  const { cols, rows } = state

  const frame: string[] = []
  frame.push(headerBar(state, theme))
  frame.push("")

  // Compact wordmark (smaller than a full-screen splash) + spectrum bar.
  const useLogo = cols >= LOGO_WIDTH + 4
  const logo = useLogo ? paintLogo(LOGO_LINES, theme) : [accent(theme, LOGO_COMPACT)]
  const logoW = useLogo ? LOGO_WIDTH : visibleWidth(LOGO_COMPACT)
  for (const line of logo) frame.push(centerLine(line, cols))
  frame.push(centerLine(spectrumBar(theme, Math.min(logoW, cols - 4)), cols))
  frame.push(centerLine(color.dim("spec-driven · spectrum-powered"), cols))
  frame.push("")

  // Get-started panel — distinct structural element.
  const panelInner = Math.min(64, cols - 8)
  const panelOffset = Math.max(0, Math.floor((cols - (panelInner + 4)) / 2))
  const actions = state.connected
    ? [
        `${accent(theme, "›")} Describe a task and press Enter`,
        `${accent(theme, "/")} commands   ${accent(theme, "@")} attach files   ${accent(theme, "!")} run shell`,
        `${accent(theme, "tab")} switch agent   ${accent(theme, "/spec")} plan a feature`,
      ]
    : [
        `${accent(theme, "/connect")}  add a provider (Zen, Go, OpenAI, Ollama…)`,
        `${accent(theme, "/model")}    pick a model`,
        color.gray("a free model is active — just start typing"),
      ]
  for (const line of panel("get started", actions, panelInner, theme)) {
    frame.push(indent(line, panelOffset))
  }

  // Spacer to push the composer toward the bottom.
  const composerLines = composer(state, theme)
  const used = frame.length + composerLines.length + 2 // + footer + hint
  const spacer = Math.max(1, rows - used - 1)
  for (let i = 0; i < spacer; i++) frame.push("")

  const cOffset = Math.max(0, Math.floor((cols - boxWidth(inputInnerWidth(cols))) / 2))
  for (const line of composerLines) frame.push(indent(line, cOffset))

  const padded = padFrame(frame, rows - 1)
  padded.push(footerBar(state, theme))
  return padFrame(padded, rows)
}

function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const rawLine of text.split("\n")) {
    if (visibleWidth(rawLine) <= width) {
      out.push(rawLine)
      continue
    }
    let line = ""
    for (const word of rawLine.split(" ")) {
      if (visibleWidth(line) + visibleWidth(word) + 1 > width) {
        out.push(line)
        line = word
      } else {
        line = line ? `${line} ${word}` : word
      }
    }
    if (line) out.push(line)
  }
  return out
}

function renderMessage(msg: RenderMessage, width: number, theme: Theme): string[] {
  if (msg.role === "user") return wrap(accent(theme, "› ") + msg.text, width)
  if (msg.role === "tool") return wrap(color.gray("  " + msg.text), width)
  if (msg.role === "system") return wrap(color.yellow(msg.text), width)
  // Assistant: render Markdown (framed code blocks, headers, bullets), indented
  // under a spectrum marker.
  const body = renderMarkdown(msg.text, Math.max(8, width - 2), theme)
  return body.map((line, i) => (i === 0 ? accent(theme, "◆ ") : "  ") + line)
}

/** Compose the chat screen: header, scrolling messages, composer, footer. */
export function renderChat(state: ViewState): string[] {
  const theme = getTheme(state.theme)
  const { cols, rows } = state
  const margin = 2
  const contentWidth = cols - margin * 2

  const composerLines = composer(state, theme)
  const menu = menuLines(state, theme)
  const reservedTop = 1 // header
  const reservedBottom = composerLines.length + menu.length + 2 // composer + hint + footer
  const messageRows = Math.max(3, rows - reservedTop - reservedBottom - 1)

  const rendered: string[] = []
  for (const msg of state.messages) {
    rendered.push(...renderMessage(msg, contentWidth, theme))
    rendered.push("")
  }
  const visible = rendered.slice(Math.max(0, rendered.length - messageRows))

  const frame: string[] = []
  frame.push(headerBar(state, theme))

  const pad = Math.max(0, messageRows - visible.length)
  for (let i = 0; i < pad; i++) frame.push("")
  for (const line of visible) frame.push(indent(line, margin))

  // Slash-command menu (if active) sits just above the composer.
  for (const line of menu) frame.push(line)

  for (const line of composerLines) frame.push(indent(line, margin))
  const hint = state.status
    ? color.gray(state.status)
    : color.dim("enter send · tab agents · / commands · @ files · ! shell · ctrl+c quit")
  frame.push(indent(hint, margin))

  const padded = padFrame(frame, rows - 1)
  padded.push(footerBar(state, theme))
  return padFrame(padded, rows)
}

export function renderFrame(state: ViewState): string[] {
  return state.mode === "welcome" ? renderWelcome(state) : renderChat(state)
}
