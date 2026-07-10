import assert from "node:assert/strict"
import test from "node:test"
import { DESKTOP_HTML } from "../src/web/desktop.js"

test("desktop renders the complete IDE workspace", () => {
  for (const feature of [
    "Explorer",
    "Source Control",
    "Specs",
    "Terminal",
    "Problems",
    "Spectra Agent",
    "Command Palette",
    "Workspace security",
    "Interrupted run found",
    "Reconnecting to Spectra Core",
  ]) {
    assert.match(DESKTOP_HTML, new RegExp(feature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }
})

test("desktop editor exposes tabs, save, diagnostics, Git, and terminal API calls", () => {
  for (const endpoint of [
    "/api/ide/bootstrap",
    "/api/ide/file/read",
    "/api/ide/file/save",
    "/api/ide/diagnostics",
    "/api/ide/terminal",
    "/api/ide/git/status",
    "/api/ide/git/diff",
    "/api/ide/spec/read",
    "/api/ide/spec/save",
  ]) assert.ok(DESKTOP_HTML.includes(endpoint), endpoint)
  assert.ok(DESKTOP_HTML.includes("Ctrl Shift P"))
  assert.ok(DESKTOP_HTML.includes("Ctrl S"))
})

test("desktop contains no remote scripts or styles", () => {
  assert.doesNotMatch(DESKTOP_HTML, /<script[^>]+src=/i)
  assert.doesNotMatch(DESKTOP_HTML, /<link[^>]+stylesheet/i)
  assert.doesNotMatch(DESKTOP_HTML, /https?:\/\//i)
})
