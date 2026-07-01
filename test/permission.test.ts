import { test } from "node:test"
import assert from "node:assert/strict"

import { evaluatePermission } from "../src/permission/index.ts"
import type { PermissionMap } from "../src/config/types.ts"

test("defaults to allow when no rule matches", () => {
  const result = evaluatePermission("read", { global: {} })
  assert.equal(result, "allow")
})

test("flat permission level applies to tool group", () => {
  const global: PermissionMap = { edit: "deny" }
  assert.equal(evaluatePermission("edit", { global }), "deny")
  assert.equal(evaluatePermission("write", { global }), "deny") // write is in edit group
})

test("agent permissions override global", () => {
  const global: PermissionMap = { bash: "deny" }
  const agent: PermissionMap = { bash: "allow" }
  assert.equal(evaluatePermission("bash", { global, agent }), "allow")
})

test("bash command patterns: last match wins", () => {
  const global: PermissionMap = {
    bash: { "*": "allow", "rm -rf *": "deny", "git push*": "ask" },
  }
  assert.equal(evaluatePermission("bash", { global }, "ls -la"), "allow")
  assert.equal(evaluatePermission("bash", { global }, "rm -rf /tmp/x"), "deny")
  assert.equal(evaluatePermission("bash", { global }, "git push origin"), "ask")
})

test("wildcard tool patterns match MCP-style names", () => {
  const global: PermissionMap = { "mymcp_*": "deny" }
  assert.equal(evaluatePermission("mymcp_search", { global }), "deny")
  assert.equal(evaluatePermission("other_tool", { global }), "allow")
})

test("global star wildcard applies as fallback", () => {
  const global: PermissionMap = { "*": "ask" }
  assert.equal(evaluatePermission("anything", { global }), "ask")
})
