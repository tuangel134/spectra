import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createRuntime } from "../src/runtime.ts"
import { createServer } from "../src/server/index.ts"

/** POST /api/verify and return the parsed body. */
async function postVerify(base: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}/api/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })
  return (await res.json()) as Record<string, unknown>
}

test("POST /api/verify runs real commands and reports a clean project", async () => {
  const project = mkdtempSync(join(tmpdir(), "spectra-verify-"))
  // A trivial project whose only verification command passes fast.
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "t", scripts: { test: "echo ok" } }))
  const rt = createRuntime({ cwd: project })
  const srv = createServer(rt, { port: 4108, hostname: "127.0.0.1", cors: [], noAuth: true })
  await srv.listen()
  try {
    const r = await postVerify("http://127.0.0.1:4108")
    assert.equal(typeof r["problems"], "number", "should report a numeric problem count")
    assert.ok(Array.isArray(r["verify"]), "should return the per-command results")
    assert.ok(Array.isArray(r["commands"]), "should return the detected commands")
    assert.equal(r["ok"], true, "a passing project with no stubs is clean")
    assert.equal(r["problems"], 0)
  } finally {
    await srv.close()
    rmSync(project, { recursive: true, force: true })
  }
})

test("POST /api/verify surfaces failing commands as problems", async () => {
  const project = mkdtempSync(join(tmpdir(), "spectra-verify-fail-"))
  // A test script that exits non-zero must be reported as a problem.
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "t", scripts: { test: "exit 1" } }))
  // A source file with a stub marker should also be flagged.
  mkdirSync(join(project, "src"), { recursive: true })
  writeFileSync(join(project, "src", "a.js"), "function f(){ // TODO implement\n}\n")
  const rt = createRuntime({ cwd: project })
  const srv = createServer(rt, { port: 4109, hostname: "127.0.0.1", cors: [], noAuth: true })
  await srv.listen()
  try {
    const r = await postVerify("http://127.0.0.1:4109")
    assert.equal(r["ok"], false, "a failing command (or stub) must make the project not-ok")
    assert.ok((r["problems"] as number) >= 1, "should count at least one problem")
  } finally {
    await srv.close()
    rmSync(project, { recursive: true, force: true })
  }
})
