import { test } from "node:test"
import assert from "node:assert/strict"

import { looksBlocked, SCRAPLING_INSTALL_HINT } from "../src/tool/scrapling.ts"

test("looksBlocked detects anti-bot status codes", () => {
  assert.equal(looksBlocked(403, "forbidden"), true)
  assert.equal(looksBlocked(429, ""), true)
  assert.equal(looksBlocked(503, ""), true)
  assert.equal(looksBlocked(200, "normal page content"), false)
})

test("looksBlocked detects Cloudflare / CAPTCHA challenge markers", () => {
  assert.equal(looksBlocked(200, "<title>Just a moment...</title>"), true)
  assert.equal(looksBlocked(200, '<div class="cf-turnstile"></div>'), true)
  assert.equal(looksBlocked(200, "Checking your browser before accessing"), true)
  assert.equal(looksBlocked(200, "verify you are human"), true)
})

test("looksBlocked does not over-trigger on large pages mentioning captcha", () => {
  const big = "captcha " + "x".repeat(9000)
  assert.equal(looksBlocked(200, big), false)
})

test("the install hint mentions the scrapling fetchers extra", () => {
  assert.match(SCRAPLING_INSTALL_HINT, /scrapling\[fetchers\]/)
})
