/**
 * Screen controller.
 *
 * Manages the terminal in full-screen mode: alternate buffer, raw keyboard
 * input, dimensions, and frame painting. Side-effecting; wraps process.stdio.
 */

import { ansi } from "./ansi.js"
import { parseKey, type Key } from "./keys.js"

/** Bracketed-paste mode control sequences and delimiters. */
const BRACKETED_PASTE_ON = "\x1b[?2004h"
const BRACKETED_PASTE_OFF = "\x1b[?2004l"
const PASTE_START = "\x1b[200~"
const PASTE_END = "\x1b[201~"

export interface ScreenSize {
  cols: number
  rows: number
}

export class Screen {
  private readonly input: NodeJS.ReadStream
  private readonly output: NodeJS.WriteStream
  private keyHandler: ((key: Key) => void) | null = null
  private resizeHandler: ((size: ScreenSize) => void) | null = null
  private active = false
  /** Bracketed-paste accumulation state (paste can span several data events). */
  private pasting = false
  private pasteBuf = ""

  constructor(
    input: NodeJS.ReadStream = process.stdin,
    output: NodeJS.WriteStream = process.stdout,
  ) {
    this.input = input
    this.output = output
  }

  /** Whether the output is an interactive terminal. */
  static isInteractive(output: NodeJS.WriteStream = process.stdout): boolean {
    return Boolean(output.isTTY)
  }

  size(): ScreenSize {
    return {
      cols: this.output.columns ?? 80,
      rows: this.output.rows ?? 24,
    }
  }

  /** Enter full-screen mode and start capturing keys. */
  start(): void {
    if (this.active) return
    this.active = true

    this.output.write(ansi.enterAltScreen + ansi.hideCursor + ansi.clear + ansi.home)

    if (this.input.isTTY) this.input.setRawMode(true)
    // Enable bracketed paste: the terminal wraps pasted text in \x1b[200~ /
    // \x1b[201~ so we can treat a multi-line paste as one insert instead of
    // firing an "enter" (submit) on the first embedded newline.
    this.output.write(BRACKETED_PASTE_ON)
    this.input.resume()
    this.input.setEncoding("utf-8")

    this.input.on("data", this.handleData)
    this.output.on("resize", this.handleResize)
  }

  /** Restore the terminal to its previous state. */
  stop(): void {
    if (!this.active) return
    this.active = false

    this.input.off("data", this.handleData)
    this.output.off("resize", this.handleResize)
    if (this.input.isTTY) this.input.setRawMode(false)
    this.input.pause()

    this.output.write(BRACKETED_PASTE_OFF + ansi.showCursor + ansi.exitAltScreen)
  }

  onKey(handler: (key: Key) => void): void {
    this.keyHandler = handler
  }

  onResize(handler: (size: ScreenSize) => void): void {
    this.resizeHandler = handler
  }

  /** Paint a full frame (array of rows). Clears and redraws. */
  render(frame: string[]): void {
    const { rows } = this.size()
    const limited = frame.slice(0, rows)
    let out = ansi.home
    for (let i = 0; i < rows; i++) {
      out += ansi.clearLine + (limited[i] ?? "")
      if (i < rows - 1) out += "\r\n"
    }
    this.output.write(out)
  }

  private handleData = (chunk: string): void => {
    let rest = chunk
    while (rest.length > 0) {
      if (this.pasting) {
        const end = rest.indexOf(PASTE_END)
        if (end === -1) {
          this.pasteBuf += rest
          return
        }
        this.pasteBuf += rest.slice(0, end)
        this.pasting = false
        this.emitPaste(this.pasteBuf)
        this.pasteBuf = ""
        rest = rest.slice(end + PASTE_END.length)
        continue
      }
      const start = rest.indexOf(PASTE_START)
      if (start === -1) {
        for (const piece of splitChunks(rest)) this.keyHandler?.(parseKey(piece))
        return
      }
      // Emit everything before the paste as ordinary keys, then start buffering.
      for (const piece of splitChunks(rest.slice(0, start))) this.keyHandler?.(parseKey(piece))
      this.pasting = true
      rest = rest.slice(start + PASTE_START.length)
    }
  }

  /** Deliver an accumulated paste as a single "paste" key event. */
  private emitPaste(text: string): void {
    this.keyHandler?.({ name: "paste", sequence: text.replace(/\r\n?/g, "\n") })
  }

  private handleResize = (): void => {
    this.resizeHandler?.(this.size())
  }
}

/** Split a raw input chunk into individual key sequences. */
export function splitChunks(chunk: string): string[] {
  const pieces: string[] = []
  let i = 0
  while (i < chunk.length) {
    if (chunk[i] === "\x1b") {
      let j = i + 1
      if (chunk[j] === "[" || chunk[j] === "O") {
        j++
        while (j < chunk.length && !/[A-Za-z~]/.test(chunk[j]!)) j++
        j++ // include the terminator
      }
      pieces.push(chunk.slice(i, j))
      i = j
    } else {
      // Take a whole code point so an emoji / astral char (a surrogate pair)
      // is emitted intact instead of split into two lone surrogates.
      const cp = chunk.codePointAt(i)!
      const ch = String.fromCodePoint(cp)
      pieces.push(ch)
      i += ch.length
    }
  }
  return pieces
}
