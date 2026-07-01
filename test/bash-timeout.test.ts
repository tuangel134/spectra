import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { bashTool } from "../src/tool/bash.ts"
import type { ToolContext } from "../src/tool/types.ts"

function ctx(dir: string): ToolContext {
  return {
    projectRoot: dir,
    agentId: "build",
    requestApproval: async () => true,
    permissionFor: () => "allow",
    report: () => {},
  }
}

test("bash timeout kills the whole process tree promptly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-bt-"))
  try {
    const start = Date.now()
    const r = await bashTool.execute({ command: "sleep 5", timeout: 300 }, ctx(dir))
    const elapsed = Date.now() - start
    assert.equal(r.success, false, "a timed-out command must report failure")
    assert.match(r.output, /timed out/)
    // The orphaned child must not keep the call alive for the full 5s.
    assert.ok(elapsed < 2500, `should return promptly after timeout, took ${elapsed}ms`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("bash returns output and exit code for a normal command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-bt2-"))
  try {
    const r = await bashTool.execute({ command: "echo hello", timeout: 5000 }, ctx(dir))
    assert.equal(r.success, true)
    assert.match(r.output, /hello/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
