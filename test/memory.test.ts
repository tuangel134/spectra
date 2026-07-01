import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MemoryStore, createMemoryTool } from "../src/memory/index.ts"
import type { ToolContext } from "../src/tool/types.ts"

const ctx = {} as ToolContext

function withStore(fn: (dir: string) => void): () => void {
  return () => {
    const dir = mkdtempSync(join(tmpdir(), "spectra-mem-"))
    try {
      fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test("MemoryStore remembers, recalls, and forgets", withStore((dir) => {
  const store = new MemoryStore(dir)
  const e = store.remember("decision", "Use SQLite for storage", ["db"])
  store.remember("api", "POST /users creates a user", ["api", "users"])
  assert.equal(store.list().length, 2)
  const hits = store.recall("user api")
  assert.ok(hits.some((h) => h.text.includes("POST /users")))
  assert.equal(store.forget(e.id), true)
  assert.equal(store.list().length, 1)
}))

test("MemoryStore persists across instances", withStore((dir) => {
  new MemoryStore(dir).remember("convention", "2-space indent")
  const reloaded = new MemoryStore(dir)
  assert.equal(reloaded.list().length, 1)
  assert.equal(reloaded.list()[0]!.text, "2-space indent")
}))

test("memory tool stores and recalls", withStore(async (dir) => {
  const tool = createMemoryTool(new MemoryStore(dir))
  await tool.execute({ action: "remember", kind: "fact", text: "Build with tsc" }, ctx)
  const recall = await tool.execute({ action: "recall", query: "build" }, ctx)
  assert.match(recall.output, /Build with tsc/)
}))
