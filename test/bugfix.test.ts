import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { incompleteEscTail } from "../src/tui/screen.ts"
import { parseDuckDuckGo } from "../src/tool/websearch.ts"
import { expandFileMentions } from "../src/context/mentions.ts"

test("incompleteEscTail detects a trailing partial escape sequence", () => {
  assert.equal(incompleteEscTail("\x1b[200"), 0) // partial PASTE_START
  assert.equal(incompleteEscTail("hi\x1b[201"), 2) // partial PASTE_END mid-stream
  assert.equal(incompleteEscTail("x\x1b"), 1) // lone trailing ESC
  assert.equal(incompleteEscTail("\x1b[200~"), -1) // complete
  assert.equal(incompleteEscTail("\x1b[A"), -1) // complete cursor key
  assert.equal(incompleteEscTail("plain text"), -1)
})

test("parseDuckDuckGo tolerates a malformed uddg link without failing the batch", () => {
  const html = `
    <a class="result__a" href="//duckduckgo.com/l/?uddg=%ZZbad">Bad</a>
    <a class="result__snippet">bad snippet</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fok.com">Good</a>
    <a class="result__snippet">good snippet</a>
  `
  const results = parseDuckDuckGo(html, 5)
  // The malformed link is skipped; the good one still comes through.
  assert.ok(results.some((r) => r.url === "https://ok.com"))
})

test("expandFileMentions allows an in-root dotfile that starts with '..'", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-dotfile-"))
  try {
    writeFileSync(join(dir, "..env.example"), "SECRET=placeholder")
    const out = expandFileMentions("check @..env.example", dir)
    assert.match(out, /SECRET=placeholder/, "a legit in-root file starting with .. must be included")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
