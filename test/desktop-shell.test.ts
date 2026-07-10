import { test } from "node:test"
import assert from "node:assert/strict"
import { DESKTOP_HTML } from "../src/web/desktop.ts"

test("desktop shell includes security, trust, recovery, and offline controls", () => {
  assert.match(DESKTOP_HTML, /Workspace security/)
  assert.match(DESKTOP_HTML, /api\/security\/status/)
  assert.match(DESKTOP_HTML, /api\/security\/profile/)
  assert.match(DESKTOP_HTML, /api\/security\/trust/)
  assert.match(DESKTOP_HTML, /api\/autorun\/resume/)
  assert.match(DESKTOP_HTML, /Reconnecting to Spectra Core/)
  assert.equal(/<script\s+src=/i.test(DESKTOP_HTML), false)
})
