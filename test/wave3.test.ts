import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { multiEditTool } from "../src/tool/multiedit.ts"
import { renderMarkdown } from "../src/tui/markdown.ts"
import { getTheme } from "../src/tui/theme.ts"
import { stripAnsi } from "../src/tui/ansi.ts"
import type { ToolContext } from "../src/tool/types.ts"

function ctx(projectRoot: string): ToolContext {
  return {
    projectRoot,
    agentId: "build",
    requestApproval: async () => true,
    report: () => {},
    permissionFor: () => "allow",
  }
}

test("multiedit applies several edits to one file atomically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-me-"))
  try {
    const f = join(dir, "a.txt")
    writeFileSync(f, "alpha beta gamma")
    const r = await multiEditTool.execute(
      { path: "a.txt", edits: [
        { oldStr: "alpha", newStr: "ALPHA" },
        { oldStr: "gamma", newStr: "GAMMA" },
      ] },
      ctx(dir),
    )
    assert.equal(r.success, true)
    assert.equal(readFileSync(f, "utf-8"), "ALPHA beta GAMMA")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("multiedit is atomic: a failing edit writes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-me2-"))
  try {
    const f = join(dir, "b.txt")
    writeFileSync(f, "one two")
    const r = await multiEditTool.execute(
      { path: "b.txt", edits: [
        { oldStr: "one", newStr: "ONE" },
        { oldStr: "MISSING", newStr: "x" },
      ] },
      ctx(dir),
    )
    assert.equal(r.success, false)
    assert.equal(readFileSync(f, "utf-8"), "one two", "file must be unchanged when any edit fails")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("renderMarkdown renders numbered lists keeping the number", () => {
  const out = renderMarkdown("1. first\n2. second", 60, getTheme("default")).map(stripAnsi)
  assert.ok(out.some((l) => l.startsWith("1. ") && l.includes("first")))
  assert.ok(out.some((l) => l.startsWith("2. ") && l.includes("second")))
})
