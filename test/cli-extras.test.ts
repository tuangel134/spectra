import { test } from "node:test"
import assert from "node:assert/strict"

import { completionScript, COMMANDS } from "../src/cli/completion.ts"
import { visibleWidth, charWidth, truncateVisible } from "../src/tui/ansi.ts"

test("completionScript emits a script for every supported shell and null otherwise", () => {
  for (const sh of ["bash", "zsh", "fish", "powershell"]) {
    const s = completionScript(sh)
    assert.ok(s && s.length > 0, `${sh} script`)
    assert.ok(s!.includes("spectra"))
  }
  assert.equal(completionScript("tcsh"), null)
  // A representative subcommand is present in the completion word list.
  assert.ok(COMMANDS.includes("update") && COMMANDS.includes("doctor"))
})

test("visibleWidth counts wide glyphs as 2, combining marks as 0, ASCII as 1", () => {
  assert.equal(charWidth("a".codePointAt(0)!), 1)
  assert.equal(charWidth("好".codePointAt(0)!), 2) // CJK
  assert.equal(charWidth("🚀".codePointAt(0)!), 2) // emoji
  assert.equal(charWidth(0x0301), 0) // combining acute accent
  assert.equal(visibleWidth("ab"), 2)
  assert.equal(visibleWidth("你好"), 4) // two wide chars
  assert.equal(visibleWidth("\x1b[31mhi\x1b[0m"), 2) // ANSI ignored
})

test("truncateVisible clips by display width and adds an ellipsis", () => {
  assert.equal(truncateVisible("hello", 10), "hello")
  const t = truncateVisible("hello world", 6)
  assert.ok(t.endsWith("…"))
  assert.ok(visibleWidth(t) <= 6)
})
