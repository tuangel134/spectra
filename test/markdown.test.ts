import { test } from "node:test"
import assert from "node:assert/strict"

import { renderMarkdown } from "../src/tui/markdown.ts"
import { getTheme } from "../src/tui/theme.ts"
import { visibleWidth, stripAnsi } from "../src/tui/ansi.ts"

const theme = getTheme("default")

test("renderMarkdown frames fenced code blocks", () => {
  const out = renderMarkdown("intro\n```js\nconst x = 1\n```\nafter", 60, theme)
  const plain = out.map(stripAnsi)
  assert.ok(plain.some((l) => l.includes("┌")), "code block top border")
  assert.ok(plain.some((l) => l.includes("│") && l.includes("const x = 1")), "code line with gutter")
  assert.ok(plain.some((l) => l.includes("└")), "code block bottom border")
})

test("renderMarkdown styles headers and bullets", () => {
  const out = renderMarkdown("# Title\n- one\n- two", 60, theme)
  const plain = out.map(stripAnsi)
  assert.ok(plain.some((l) => l.includes("Title")))
  assert.ok(plain.filter((l) => l.includes("•")).length === 2, "two bullets")
})

test("renderMarkdown wraps prose to the given width", () => {
  const long = "word ".repeat(40).trim()
  const out = renderMarkdown(long, 30, theme)
  for (const line of out) assert.ok(visibleWidth(line) <= 30, `line within width: "${line}"`)
})
