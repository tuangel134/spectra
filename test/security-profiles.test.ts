import { test } from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_CONFIG } from "../src/config/defaults.ts"
import { applySecurityProfile, isSecurityProfile } from "../src/security/profiles.ts"

test("security profiles validate known ids", () => {
  assert.equal(isSecurityProfile("safe"), true)
  assert.equal(isSecurityProfile("balanced"), true)
  assert.equal(isSecurityProfile("anything"), false)
})

test("safe profile supervises writes and commands", () => {
  const config = structuredClone(DEFAULT_CONFIG)
  applySecurityProfile(config, "safe")
  assert.equal(config.security.profile, "safe")
  assert.equal(config.autoApprove, false)
  assert.equal(config.permission["edit"], "ask")
  assert.equal(config.permission["bash"], "ask")
  assert.equal(config.permission["*"], "ask")
  assert.equal(config.autorun.parallel, false)
})

test("autonomous profile enables normal work and retains an explicit unknown-tool fallback", () => {
  const config = structuredClone(DEFAULT_CONFIG)
  applySecurityProfile(config, "autonomous")
  assert.equal(config.autoApprove, true)
  assert.equal(config.permission["edit"], "allow")
  assert.equal(config.permission["bash"], "allow")
  assert.equal(config.permission["*"], "ask")
})

test("legacy profile preserves historical permission settings", () => {
  const config = structuredClone(DEFAULT_CONFIG)
  config.permission = { bash: "deny" }
  config.autoApprove = false
  applySecurityProfile(config, "legacy")
  assert.deepEqual(config.permission, { bash: "deny" })
  assert.equal(config.autoApprove, false)
})

test("profile changes preserve live permission and autorun references", () => {
  const config = structuredClone(DEFAULT_CONFIG)
  const permissionRef = config.permission
  const autorunRef = config.autorun
  applySecurityProfile(config, "balanced")
  assert.equal(config.permission, permissionRef)
  assert.equal(config.autorun, autorunRef)
  assert.equal(permissionRef["edit"], "allow")
  assert.equal(autorunRef.maxParallel, 4)
})

