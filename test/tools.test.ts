import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readTool } from "../src/tool/read.ts"
import { writeTool } from "../src/tool/write.ts"
import { editTool } from "../src/tool/edit.ts"
import type { ToolContext } from "../src/tool/types.ts"

function makeContext(root: string): ToolContext {
  return {
    projectRoot: root,
    agentId: "build",
    requestApproval: async () => true,
    permissionFor: () => "allow",
    report: () => {},
  }
}

function withTempDir(fn: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "spectra-test-"))
    try {
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test(
  "write tool creates a file",
  withTempDir(async (dir) => {
    const ctx = makeContext(dir)
    const result = await writeTool.execute({ path: "hello.txt", content: "hi there" }, ctx)
    assert.equal(result.success, true)
    assert.equal(readFileSync(join(dir, "hello.txt"), "utf-8"), "hi there")
  }),
)

test(
  "read tool compresses an oversized JSON array instead of truncating",
  withTempDir(async (dir) => {
    const ctx = makeContext(dir)
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: i,
      name: "item_" + i,
      active: i % 2 === 0,
      meta: { created: "2026-01-01", note: "padding ".repeat(8) },
    }))
    writeFileSync(join(dir, "big.json"), JSON.stringify(rows, null, 2))
    const result = await readTool.execute({ path: "big.json" }, ctx)
    assert.equal(result.success, true)
    assert.equal((result.metadata as { compressed?: boolean }).compressed, true)
    assert.match(result.output, /500 rows/)
    assert.ok(result.output.length < JSON.stringify(rows, null, 2).length)
  }),
)

test(
  "read tool returns file contents",
  withTempDir(async (dir) => {
    writeFileSync(join(dir, "data.txt"), "line1\nline2\nline3")
    const ctx = makeContext(dir)
    const result = await readTool.execute({ path: "data.txt" }, ctx)
    assert.equal(result.success, true)
    assert.ok(result.output.includes("line2"))
  }),
)

test(
  "read tool supports line ranges",
  withTempDir(async (dir) => {
    writeFileSync(join(dir, "data.txt"), "a\nb\nc\nd\ne")
    const ctx = makeContext(dir)
    const result = await readTool.execute({ path: "data.txt", startLine: 2, endLine: 4 }, ctx)
    assert.equal(result.output, "b\nc\nd")
  }),
)

test(
  "edit tool replaces an exact string",
  withTempDir(async (dir) => {
    writeFileSync(join(dir, "code.ts"), "const x = 1\nconst y = 2\n")
    const ctx = makeContext(dir)
    const result = await editTool.execute(
      { path: "code.ts", oldStr: "const x = 1", newStr: "const x = 42" },
      ctx,
    )
    assert.equal(result.success, true)
    assert.ok(readFileSync(join(dir, "code.ts"), "utf-8").includes("const x = 42"))
  }),
)

test(
  "edit tool fails when oldStr matches multiple times without replaceAll",
  withTempDir(async (dir) => {
    writeFileSync(join(dir, "code.ts"), "foo\nfoo\n")
    const ctx = makeContext(dir)
    const result = await editTool.execute({ path: "code.ts", oldStr: "foo", newStr: "bar" }, ctx)
    assert.equal(result.success, false)
    assert.ok(result.output.includes("matches"))
  }),
)

test(
  "edit tool replaceAll replaces every occurrence",
  withTempDir(async (dir) => {
    writeFileSync(join(dir, "code.ts"), "foo\nfoo\nfoo\n")
    const ctx = makeContext(dir)
    const result = await editTool.execute(
      { path: "code.ts", oldStr: "foo", newStr: "bar", replaceAll: true },
      ctx,
    )
    assert.equal(result.success, true)
    const content = readFileSync(join(dir, "code.ts"), "utf-8")
    assert.equal(content, "bar\nbar\nbar\n")
  }),
)

test(
  "write tool respects deny permission",
  withTempDir(async (dir) => {
    const ctx: ToolContext = { ...makeContext(dir), permissionFor: () => "deny" }
    const result = await writeTool.execute({ path: "blocked.txt", content: "x" }, ctx)
    assert.equal(result.success, false)
  }),
)

test(
  "edit tool inserts newStr literally even when it contains $ patterns",
  withTempDir(async (dir) => {
    writeFileSync(join(dir, "code.ts"), "const price = OLD\n")
    const ctx = makeContext(dir)
    const result = await editTool.execute(
      { path: "code.ts", oldStr: "OLD", newStr: "$1 + $& + $`" },
      ctx,
    )
    assert.equal(result.success, true)
    // The literal replacement string must be preserved, not interpreted.
    assert.equal(readFileSync(join(dir, "code.ts"), "utf-8"), "const price = $1 + $& + $`\n")
  }),
)

test(
  "edit tool rejects an empty oldStr instead of corrupting the file",
  withTempDir(async (dir) => {
    writeFileSync(join(dir, "code.ts"), "hello world\n")
    const ctx = makeContext(dir)
    const result = await editTool.execute({ path: "code.ts", oldStr: "", newStr: "X", replaceAll: true }, ctx)
    assert.equal(result.success, false)
    assert.equal(readFileSync(join(dir, "code.ts"), "utf-8"), "hello world\n")
  }),
)

test(
  "write tool requires approval for a path outside the project root",
  withTempDir(async (dir) => {
    let asked = false
    const ctx: ToolContext = {
      ...makeContext(dir),
      requestApproval: async () => {
        asked = true
        return false
      },
    }
    const result = await writeTool.execute({ path: "../escape.txt", content: "x" }, ctx)
    assert.equal(asked, true, "an external write must prompt for approval even when allowed")
    assert.equal(result.success, false, "a denied external write must not proceed")
  }),
)
