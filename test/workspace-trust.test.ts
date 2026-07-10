import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkspaceTrustManager } from "../src/security/trust.ts"

test("Workspace Trust is implicit until executable project assets appear", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-trust-project-"))
  const config = mkdtempSync(join(tmpdir(), "spectra-trust-config-"))
  const oldXdg = process.env["XDG_CONFIG_HOME"]
  process.env["XDG_CONFIG_HOME"] = config
  try {
    const clean = new WorkspaceTrustManager(root)
    assert.equal(clean.status().state, "implicit")
    assert.equal(clean.isTrusted(), true)

    mkdirSync(join(root, ".spectra", "plugins"), { recursive: true })
    const plugin = join(root, ".spectra", "plugins", "hello.mjs")
    writeFileSync(plugin, "export default () => {}", "utf-8")

    const manager = new WorkspaceTrustManager(root)
    assert.equal(manager.status().state, "untrusted")
    assert.equal(manager.isTrusted(), false)
    assert.equal(manager.status().findings[0]?.kind, "plugin")

    assert.equal(manager.trustPermanently().trusted, true)
    writeFileSync(plugin, "export default () => { /* changed */ }", "utf-8")
    assert.equal(manager.status().state, "changed")
    assert.equal(manager.isTrusted(), false)

    assert.equal(manager.trustOnce().trusted, true)
    assert.equal(manager.restrict().trusted, false)
  } finally {
    if (oldXdg === undefined) delete process.env["XDG_CONFIG_HOME"]
    else process.env["XDG_CONFIG_HOME"] = oldXdg
    rmSync(root, { recursive: true, force: true })
    rmSync(config, { recursive: true, force: true })
  }
})

test("Workspace Trust hashes complete executable assets", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-trust-full-hash-"))
  const config = mkdtempSync(join(tmpdir(), "spectra-trust-full-config-"))
  const oldXdg = process.env["XDG_CONFIG_HOME"]
  process.env["XDG_CONFIG_HOME"] = config
  try {
    const dir = join(root, ".spectra", "plugins")
    mkdirSync(dir, { recursive: true })
    const plugin = join(dir, "large.mjs")
    const prefix = "x".repeat(300 * 1024)
    writeFileSync(plugin, prefix + "A", "utf-8")
    const manager = new WorkspaceTrustManager(root)
    manager.trustPermanently()

    // Same size and same first 300 KiB; only the final byte changes.
    writeFileSync(plugin, prefix + "B", "utf-8")
    assert.equal(manager.status().state, "changed")
    assert.equal(manager.isTrusted(), false)
  } finally {
    if (oldXdg === undefined) delete process.env["XDG_CONFIG_HOME"]
    else process.env["XDG_CONFIG_HOME"] = oldXdg
    rmSync(root, { recursive: true, force: true })
    rmSync(config, { recursive: true, force: true })
  }
})
