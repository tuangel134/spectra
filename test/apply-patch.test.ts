import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { applyPatchTool } from "../src/tool/apply-patch.ts"
import type { ToolContext } from "../src/tool/types.ts"

function ctx(projectRoot: string): ToolContext {
  return {
    projectRoot,
    agentId: "build",
    requestApproval: async () => false, // deny out-of-root by default
    report: () => {},
    permissionFor: () => "allow",
  }
}

test("apply_patch applies create/edit/delete atomically and reports changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-ap-"))
  try {
    writeFileSync(join(dir, "keep.ts"), "const version = 1\n")
    writeFileSync(join(dir, "old.ts"), "remove me\n")
    const res = await applyPatchTool.execute(
      {
        operations: [
          { type: "create", path: "new.ts", content: "export const x = 1\n" },
          { type: "edit", path: "keep.ts", oldString: "version = 1", newString: "version = 2" },
          { type: "delete", path: "old.ts" },
        ],
      },
      ctx(dir),
    )
    assert.equal(res.success, true)
    assert.equal(readFileSync(join(dir, "new.ts"), "utf-8"), "export const x = 1\n")
    assert.match(readFileSync(join(dir, "keep.ts"), "utf-8"), /version = 2/)
    assert.equal(existsSync(join(dir, "old.ts")), false)
    const changes = (res.metadata?.["changes"] ?? []) as unknown[]
    assert.equal(changes.length, 3, "reports all three changes for undo")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("apply_patch is all-or-nothing: an invalid op writes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-ap2-"))
  try {
    writeFileSync(join(dir, "a.ts"), "hello\n")
    const res = await applyPatchTool.execute(
      {
        operations: [
          { type: "create", path: "should-not-exist.ts", content: "nope" },
          { type: "edit", path: "a.ts", oldString: "NOT PRESENT", newString: "x" },
        ],
      },
      ctx(dir),
    )
    assert.equal(res.success, false)
    assert.equal(existsSync(join(dir, "should-not-exist.ts")), false, "first op must not have been applied")
    assert.equal(readFileSync(join(dir, "a.ts"), "utf-8"), "hello\n", "target unchanged")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
