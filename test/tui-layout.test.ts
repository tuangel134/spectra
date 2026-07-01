import { test } from "node:test"
import assert from "node:assert/strict"

import { renderWelcome, renderChat, type ViewState } from "../src/tui/layout.ts"
import { stripAnsi, visibleWidth } from "../src/tui/ansi.ts"
import { drawBox, centerLine } from "../src/tui/box.ts"
import { parseKey } from "../src/tui/keys.ts"
import { splitChunks } from "../src/tui/screen.ts"

function baseState(overrides: Partial<ViewState> = {}): ViewState {
  return {
    cols: 100,
    rows: 30,
    mode: "welcome",
    agent: "build",
    model: "opencode/claude-sonnet-4-6",
    connected: false,
    input: "",
    messages: [],
    busy: false,
    version: "0.1.0",
    ...overrides,
  }
}

test("welcome frame has exactly `rows` lines", () => {
  const frame = renderWelcome(baseState())
  assert.equal(frame.length, 30)
})

test("welcome frame renders the logo and input box", () => {
  const frame = renderWelcome(baseState()).map(stripAnsi)
  const joined = frame.join("\n")
  // Logo uses block characters.
  assert.ok(joined.includes("███"), "should contain block logo")
  // Rounded box borders (composer + panel).
  assert.ok(joined.includes("╭") && joined.includes("╯"), "should contain rounded borders")
  // Header chrome with the brand.
  assert.ok(joined.includes("SPECTRA"), "should show the header brand")
  // Composer placeholder.
  assert.ok(joined.includes("Describe a task"), "should show placeholder")
  // Get-started panel.
  assert.ok(joined.includes("get started"), "should show the get-started panel")
})

test("welcome frame shows /connect tip when not connected", () => {
  const frame = renderWelcome(baseState({ connected: false })).map(stripAnsi).join("\n")
  assert.ok(frame.includes("/connect"))
})

test("typed input replaces the placeholder", () => {
  const frame = renderWelcome(baseState({ input: "hola mundo" })).map(stripAnsi).join("\n")
  assert.ok(frame.includes("hola mundo"))
})

test("chat frame shows messages and pins input box", () => {
  const frame = renderChat(
    baseState({
      mode: "chat",
      messages: [
        { role: "user", text: "crea un archivo" },
        { role: "assistant", text: "listo, creado" },
      ],
    }),
  ).map(stripAnsi)
  const joined = frame.join("\n")
  assert.equal(frame.length, 30)
  assert.ok(joined.includes("crea un archivo"))
  assert.ok(joined.includes("listo, creado"))
  assert.ok(joined.includes("╭"), "input box still present")
})

test("drawBox produces aligned borders", () => {
  const box = drawBox({ width: 10, content: ["hi"] })
  assert.equal(box.length, 3)
  assert.equal(visibleWidth(box[0]!), visibleWidth(box[1]!))
  assert.equal(visibleWidth(box[1]!), visibleWidth(box[2]!))
})

test("centerLine centers within width", () => {
  const line = centerLine("ab", 10)
  assert.equal(line, "    ab")
})

test("parseKey recognizes control keys", () => {
  assert.equal(parseKey("\r").name, "enter")
  assert.equal(parseKey("\x7f").name, "backspace")
  assert.equal(parseKey("\t").name, "tab")
  assert.equal(parseKey("\x03").name, "ctrl-c")
  assert.equal(parseKey("\x10").name, "ctrl-p")
  assert.equal(parseKey("\x1b[A").name, "up")
  assert.equal(parseKey("a").name, "char")
  assert.equal(parseKey("a").sequence, "a")
})

test("splitChunks separates escape sequences from chars", () => {
  assert.deepEqual(splitChunks("ab"), ["a", "b"])
  assert.deepEqual(splitChunks("\x1b[Ax"), ["\x1b[A", "x"])
  assert.deepEqual(splitChunks("\x1b[B\x1b[C"), ["\x1b[B", "\x1b[C"])
})

test("splitChunks keeps an emoji (surrogate pair) intact", () => {
  // "🚀" is a single code point stored as two UTF-16 units. It must be emitted
  // as ONE piece, not split into two lone surrogates.
  assert.deepEqual(splitChunks("a🚀b"), ["a", "🚀", "b"])
})

test("parseKey treats a whole emoji as a single printable char", () => {
  const k = parseKey("🚀")
  assert.equal(k.name, "char")
  assert.equal(k.sequence, "🚀")
})
