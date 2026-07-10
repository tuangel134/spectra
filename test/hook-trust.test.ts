import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HookRegistry } from "../src/hook/index.ts"

test("Workspace Trust blocks project hooks before process creation", async () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-hook-trust-"))
  try {
    const dir = join(root, ".spectra", "hooks")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "blocked.json"),
      JSON.stringify({
        name: "blocked",
        version: "1",
        when: { type: "userTriggered" },
        then: { type: "runCommand", command: "node -e \"require('fs').writeFileSync('owned.txt','x')\"" },
      }),
      "utf-8",
    )
    const hooks = new HookRegistry(root, { canExecute: () => false })
    const result = await hooks.fire({ type: "userTriggered" }, root)
    assert.equal(result.length, 1)
    assert.equal(result[0]?.success, false)
    assert.match(result[0]?.output ?? "", /Workspace Trust/)
    assert.equal(existsSync(join(root, "owned.txt")), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("hook interpolation quotes hostile file names", async () => {
  if (process.platform === "win32") return
  const root = mkdtempSync(join(tmpdir(), "spectra-hook-quote-"))
  try {
    const dir = join(root, ".spectra", "hooks")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "quote.json"),
      JSON.stringify({
        name: "quote",
        version: "1",
        when: { type: "fileEdited", patterns: ["*"] },
        then: { type: "runCommand", command: "printf '%s' $FILE" },
      }),
      "utf-8",
    )
    const hooks = new HookRegistry(root)
    const hostile = "safe; touch injected.txt"
    const result = await hooks.fire({ type: "fileEdited", filePath: hostile }, root)
    assert.equal(result[0]?.success, true)
    assert.equal(result[0]?.output, hostile)
    assert.equal(existsSync(join(root, "injected.txt")), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
