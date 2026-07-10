import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("server exposes production readiness and recovery APIs", () => {
  const source = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8")
  for (const route of ["/api/production/status", "/api/production/recovery", "/api/production/recovery/ack"]) assert.match(source, new RegExp(route.replaceAll("/", "\\/")))
  assert.match(source, /version:\s*"1\.0\.0"/)
  assert.equal(source.match(/"content-security-policy"/g)?.length, 1)
  assert.match(source, /"x-frame-options": "SAMEORIGIN"/)
  assert.match(source, /"permissions-policy"/)
})

test("Desktop exposes production readiness without remote assets", () => {
  const source = readFileSync(new URL("../src/web/desktop.ts", import.meta.url), "utf8")
  assert.match(source, /Production readiness/); assert.match(source, /api\/production\/status/); assert.doesNotMatch(source, /<script[^>]+src=/i); assert.doesNotMatch(source, /<link[^>]+href=/i)
})

test("release workflow packages and signs all supported desktop formats", () => {
  const source = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")
  for (const token of ["appimage", "deb", "pacman", "dmg", "wix", "nsis", "cosign", "update-manifest.json", "SPECTRA_UPDATE_PRIVATE_KEY_B64"]) assert.match(source.toLowerCase(), new RegExp(token.toLowerCase()))
})

test("provider credentials are represented by secret references in regression tests", () => {
  const writer = readFileSync(new URL("../test/writer.test.ts", import.meta.url), "utf8")
  const flows = readFileSync(new URL("../test/tui-flow.test.ts", import.meta.url), "utf8")
  assert.match(writer, /\{secret:provider:mylab\}/)
  assert.match(flows, /\{secret:provider:opencode\}/)
})

test("production scripts include E2E, stress, performance, SBOM, and audit gates", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> }
  for (const script of ["test:e2e", "test:stress", "test:performance", "audit:production", "release:sbom", "release:manifest"]) assert.ok(packageJson.scripts[script])
})
