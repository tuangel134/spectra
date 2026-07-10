import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("runtime exposes the multi-agent coordinator", () => {
  const source = readFileSync(new URL("../src/runtime.ts", import.meta.url), "utf-8")
  assert.match(source, /multiagent:\s*MultiAgentCoordinator/)
  assert.match(source, /new MultiAgentCoordinator\(projectRoot/)
  const runtimeObject = source.slice(source.indexOf("const runtime: Runtime ="), source.indexOf("runtime.autorun ="))
  assert.match(runtimeObject, /\bmultiagent,/, "runtime object must retain the coordinator")
  assert.match(source, /rt\.multiagent\s*=\s*fresh\.multiagent/, "project reload must replace the coordinator")
})

test("server exposes multi-agent planning and execution endpoints", () => {
  const source = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf-8")
  assert.match(source, /\/api\/multiagent\/plan/)
  assert.match(source, /\/api\/multiagent\/runs/)
  assert.match(source, /SpectraIsolatedAgentRunner/)
})

test("Desktop exposes the isolated agents control panel", () => {
  const source = readFileSync(new URL("../src/web/desktop.ts", import.meta.url), "utf-8")
  assert.match(source, /spectra-multiagent-panel/)
  assert.match(source, /Isolated agents/)
})
