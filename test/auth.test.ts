import { test } from "node:test"
import assert from "node:assert/strict"

import { interpretTokenResponse, DEVICE_FLOW_PRESETS } from "../src/auth/device.ts"

test("interpretTokenResponse returns success with an access token", () => {
  const r = interpretTokenResponse({ access_token: "abc", token_type: "bearer" }, 5000)
  assert.equal(r.status, "success")
  if (r.status === "success") assert.equal(r.accessToken, "abc")
})

test("interpretTokenResponse maps authorization_pending to pending", () => {
  const r = interpretTokenResponse({ error: "authorization_pending" }, 5000)
  assert.equal(r.status, "pending")
})

test("interpretTokenResponse backs off on slow_down", () => {
  const r = interpretTokenResponse({ error: "slow_down" }, 5000)
  assert.equal(r.status, "slow_down")
  if (r.status === "slow_down") assert.equal(r.intervalMs, 10000)
})

test("interpretTokenResponse surfaces fatal errors", () => {
  const r = interpretTokenResponse({ error: "access_denied", error_description: "user said no" }, 5000)
  assert.equal(r.status, "error")
  if (r.status === "error") assert.match(r.error, /user said no/)
})

test("a copilot device-flow preset exists", () => {
  assert.ok(DEVICE_FLOW_PRESETS["copilot"])
  assert.match(DEVICE_FLOW_PRESETS["copilot"]!.deviceCodeUrl, /github\.com/)
})
