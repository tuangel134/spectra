import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expandFileMentions } from "../src/context/mentions.ts"
import { loadCustomCommands, expandCommandTemplate } from "../src/commands/custom.ts"

test("expandFileMentions inlines referenced files and skips missing/out-of-root", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-men-"))
  try {
    writeFileSync(join(dir, "notes.txt"), "hello from notes")
    const out = expandFileMentions("please read @notes.txt and @missing.txt", dir)
    assert.match(out, /hello from notes/)
    assert.match(out, /=== notes\.txt ===/)
    // No crash / no inclusion for the missing file.
    assert.doesNotMatch(out, /missing\.txt ===/)
    // Path traversal is refused.
    const esc = expandFileMentions("see @../../etc/passwd", dir)
    assert.doesNotMatch(esc, /root:/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("expandFileMentions is a no-op when there are no @mentions", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-men2-"))
  try {
    assert.equal(expandFileMentions("just a normal message", dir), "just a normal message")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("loadCustomCommands reads .spectra/commands and expands templates", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-cmd-"))
  try {
    mkdirSync(join(dir, ".spectra", "commands"), { recursive: true })
    writeFileSync(
      join(dir, ".spectra", "commands", "review.md"),
      "---\ndescription: Review a file\n---\nReview $ARGUMENTS carefully and list issues.",
    )
    const cmds = loadCustomCommands(dir)
    assert.equal(cmds.length, 1)
    assert.equal(cmds[0]!.name, "review")
    assert.equal(cmds[0]!.description, "Review a file")
    const expanded = expandCommandTemplate(cmds[0]!.template, "src/app.ts")
    assert.equal(expanded, "Review src/app.ts carefully and list issues.")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("expandCommandTemplate substitutes positional args", () => {
  assert.equal(expandCommandTemplate("compare $1 with $2", "a.ts b.ts"), "compare a.ts with b.ts")
})
