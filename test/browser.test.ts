import { test } from "node:test"
import assert from "node:assert/strict"

import { browserTool, capture, PLAYWRIGHT_HINT } from "../src/tool/browser.ts"
import type { ToolContext } from "../src/tool/types.ts"

function ctx(): ToolContext {
  return {
    projectRoot: "/tmp",
    agentId: "t",
    requestApproval: async () => true,
    permissionFor: () => "allow",
    report: () => {},
  }
}

test("browser tool rejects non-http urls", async () => {
  const res = await browserTool.execute({ url: "ftp://x" }, ctx())
  assert.equal(res.success, false)
  assert.match(res.output, /http/)
})

test("capture reports missing Playwright gracefully (when not installed)", async () => {
  const result = await capture("http://127.0.0.1:9/nonexistent", { screenshot: true })
  // Either Playwright is absent (missing=true) or it is present and the
  // unreachable URL fails — both are clean, non-throwing outcomes.
  assert.equal(result.ok, false)
  assert.ok(result.missing === true || typeof result.error === "string")
})

test("the install hint mentions playwright install", () => {
  assert.match(PLAYWRIGHT_HINT, /playwright install/)
})
