import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  updateConfig,
  readRawConfig,
  saveCustomProvider,
  removeProvider,
  saveCompaction,
  saveRouting,
  savePermission,
  projectConfigPath,
} from "../src/config/writer.ts"
import { parseJsonc } from "../src/config/loader.ts"

function withTempFile(fn: (path: string) => void): () => void {
  return () => {
    const dir = mkdtempSync(join(tmpdir(), "spectra-writer-"))
    try {
      fn(join(dir, "spectra.jsonc"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test(
  "updateConfig creates a file and persists changes",
  withTempFile((path) => {
    updateConfig(path, (config) => {
      config.model = "opencode/claude-opus-4-8"
      config.provider = { opencode: { options: { apiKey: "k" } } }
    })
    const reloaded = parseJsonc(readFileSync(path, "utf-8")) as { model: string }
    assert.equal(reloaded.model, "opencode/claude-opus-4-8")
  }),
)

test(
  "updateConfig preserves existing keys when mutating",
  withTempFile((path) => {
    updateConfig(path, (c) => {
      c.model = "a/b"
      c.snapshot = true
    })
    updateConfig(path, (c) => {
      c.model = "c/d" // change only the model
    })
    const reloaded = readRawConfig(path)
    assert.equal(reloaded.model, "c/d")
    assert.equal(reloaded.snapshot, true) // preserved
  }),
)

test(
  "readRawConfig returns empty object for a missing file",
  withTempFile((path) => {
    assert.deepEqual(readRawConfig(path), {})
  }),
)

/**
 * The CRUD writers below target the global config, resolved through homedir().
 * We redirect HOME to a temp dir so we exercise the real functions without
 * touching the user's actual configuration.
 */
function withTempHome(fn: (configPath: string) => void): () => void {
  return () => {
    const dir = mkdtempSync(join(tmpdir(), "spectra-home-"))
    const prevHome = process.env.HOME
    const prevUserProfile = process.env.USERPROFILE
    process.env.HOME = dir
    process.env.USERPROFILE = dir
    try {
      fn(join(dir, ".config", "spectra", "spectra.jsonc"))
    } finally {
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
      if (prevUserProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = prevUserProfile
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test(
  "saveCustomProvider stores an openai-compatible provider with its model",
  withTempHome((configPath) => {
    saveCustomProvider({ id: "mylab", baseURL: "https://api.mylab.test/v1", apiKey: "sk-1", model: "fast" })
    const config = readRawConfig(configPath)
    const provider = config.provider?.mylab
    assert.equal(provider?.sdk, "openai-compatible")
    assert.equal(provider?.baseURL, "https://api.mylab.test/v1")
    assert.equal(provider?.options?.apiKey, "sk-1")
    assert.deepEqual(provider?.models?.fast, { name: "fast" })
  }),
)

test(
  "removeProvider deletes only the targeted provider",
  withTempHome((configPath) => {
    saveCustomProvider({ id: "keep", baseURL: "https://keep.test/v1" })
    saveCustomProvider({ id: "drop", baseURL: "https://drop.test/v1" })
    removeProvider("drop")
    const config = readRawConfig(configPath)
    assert.ok(config.provider?.keep, "untargeted provider should remain")
    assert.equal(config.provider?.drop, undefined, "targeted provider should be gone")
  }),
)

test(
  "saveCompaction merges settings without clobbering siblings (PROJECT config)",
  withTempFile((path) => {
    const projectRoot = join(path, "..")
    saveCompaction({ auto: true }, projectRoot)
    saveCompaction({ reserved: 4096 }, projectRoot)
    const config = readRawConfig(projectConfigPath(projectRoot))
    assert.equal(config.compaction?.auto, true, "auto preserved across writes")
    assert.equal(config.compaction?.reserved, 4096)
  }),
)

test(
  "behavioral settings write to the PROJECT config, not global",
  withTempFile((path) => {
    const projectRoot = join(path, "..")
    savePermission("bash", "deny", projectRoot)
    saveRouting({ mode: "tiered" }, projectRoot)
    const config = readRawConfig(projectConfigPath(projectRoot))
    assert.equal(config.permission?.bash, "deny")
    assert.equal(config.routing?.mode, "tiered")
  }),
)
