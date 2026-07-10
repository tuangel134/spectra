import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("desktop launcher delegates lifecycle to the persistent Core supervisor", () => {
  const source = readFileSync(join(process.cwd(), "src", "desktop", "launcher.ts"), "utf-8")
  assert.match(source, /ensureCore/)
  assert.match(source, /startCoreHeartbeat/)
  assert.match(source, /core\.url \+ "\/desktop"/)
  assert.doesNotMatch(source, /const server = createServer\(rt/)
})

test("CLI starts desktop and core commands before constructing an in-process runtime", () => {
  const source = readFileSync(join(process.cwd(), "src", "cli.ts"), "utf-8")
  const desktop = source.indexOf('command === "desktop"')
  const runtime = source.indexOf("const rt = createRuntime()")
  assert.ok(desktop >= 0 && runtime >= 0 && desktop < runtime)
  assert.match(source, /core-daemon/)
  assert.match(source, /runCoreCommand/)
})

test("project switching transfers the persistent Core lease to the active workspace", () => {
  const source = readFileSync(join(process.cwd(), "src", "server", "index.ts"), "utf-8")
  const matches = source.match(/onProjectChanged\?\.\(rt\.config\.projectRoot\)/g) ?? []
  assert.equal(matches.length >= 2, true)
})
