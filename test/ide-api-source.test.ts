import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("server exposes the guarded Desktop IDE API", () => {
  const source = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf-8")
  for (const route of [
    "/api/ide/bootstrap",
    "/api/ide/file/read",
    "/api/ide/file/save",
    "/api/ide/diagnostics",
    "/api/ide/terminal",
    "/api/ide/git/status",
    "/api/ide/git/diff",
    "/api/ide/spec/read",
    "/api/ide/spec/save",
  ]) assert.ok(source.includes(route), route)
  assert.ok(source.includes("new IdeService(rt)"))
})
