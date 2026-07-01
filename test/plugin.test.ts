import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PluginManager } from "../src/plugin/index.ts"
import { ToolRegistry } from "../src/tool/registry.ts"

function withPlugins(fn: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "spectra-plugin-"))
    try {
      mkdirSync(join(dir, ".spectra", "plugins"), { recursive: true })
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test("PluginManager loads a plugin that registers a tool", withPlugins(async (dir) => {
  writeFileSync(
    join(dir, ".spectra", "plugins", "hello.mjs"),
    `export default function({ registerTool }) {
       registerTool({
         name: "hello_plugin",
         description: "say hi",
         category: "meta",
         parameters: { type: "object", properties: {}, additionalProperties: false },
         async execute() { return { success: true, output: "hi" } },
       })
     }`,
  )
  const tools = new ToolRegistry([])
  const mgr = new PluginManager(dir, tools)
  const loaded = await mgr.loadAll()
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0]!.tools[0], "hello_plugin")
  assert.ok(tools.has("hello_plugin"))
  const tool = tools.get("hello_plugin")!
  const res = await tool.execute({}, {} as never)
  assert.equal(res.output, "hi")
}))

test("PluginManager records an error for a broken plugin", withPlugins(async (dir) => {
  writeFileSync(join(dir, ".spectra", "plugins", "broken.mjs"), "export default 123")
  const mgr = new PluginManager(dir, new ToolRegistry([]))
  const loaded = await mgr.loadAll()
  assert.equal(loaded.length, 1)
  assert.ok(loaded[0]!.error, "should record an error")
}))

test("PluginManager is a no-op when no plugins dir exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-noplug-"))
  try {
    const loaded = await new PluginManager(dir, new ToolRegistry([])).loadAll()
    assert.deepEqual(loaded, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
