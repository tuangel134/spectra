import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadSteering } from "../src/steering/index.ts"
import { parseDuckDuckGo } from "../src/tool/websearch.ts"
import { todoWriteTool, todoReadTool, getTodos } from "../src/tool/todo.ts"
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

test("loadSteering injects AGENTS.md and always-included steering, skips manual", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-steer-"))
  try {
    writeFileSync(join(dir, "AGENTS.md"), "# Conventions\nUse tabs.")
    mkdirSync(join(dir, ".spectra", "steering"), { recursive: true })
    writeFileSync(join(dir, ".spectra", "steering", "always.md"), "Always run tests.")
    writeFileSync(
      join(dir, ".spectra", "steering", "manual.md"),
      "---\ninclusion: manual\n---\nOnly when asked.",
    )
    const text = loadSteering(dir)
    assert.match(text, /Use tabs/)
    assert.match(text, /Always run tests/)
    assert.doesNotMatch(text, /Only when asked/, "manual steering must NOT be auto-injected")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("loadSteering is empty for a project with no steering", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-steer2-"))
  try {
    assert.equal(loadSteering(dir), "")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("parseDuckDuckGo extracts title, decoded url, and snippet", () => {
  const html = `
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a>
    <a class="result__snippet">The official docs for Example.</a>
  `
  const results = parseDuckDuckGo(html, 5)
  assert.equal(results.length, 1)
  assert.equal(results[0]!.title, "Example Docs")
  assert.equal(results[0]!.url, "https://example.com/docs")
  assert.match(results[0]!.snippet, /official docs/)
})

test("todowrite stores the list and todoread renders progress", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-todo-"))
  try {
    await todoWriteTool.execute(
      { todos: [
        { content: "Write parser", status: "completed" },
        { content: "Wire loop", status: "in_progress" },
        { content: "Add tests", status: "pending" },
      ] },
      ctx(dir),
    )
    const items = getTodos(dir)
    assert.equal(items.length, 3)
    assert.equal(items[0]!.status, "completed")
    const read = await todoReadTool.execute({}, ctx(dir))
    assert.match(read.output, /1\/3 done/)
    assert.match(read.output, /Wire loop/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
