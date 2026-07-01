import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { LspClient } from "../src/lsp/client.ts"
import { LspManager, languageForFile } from "../src/lsp/manager.ts"
import { formatDiagnostics } from "../src/lsp/index.ts"

const FAKE = resolve(fileURLToPath(new URL("./fixtures/fake-lsp-server.mjs", import.meta.url)))
const SPEC = { command: "node", args: [FAKE], languageId: "typescript" }

test("languageForFile maps extensions to language ids", () => {
  assert.equal(languageForFile("a.ts"), "typescript")
  assert.equal(languageForFile("b.py"), "python")
  assert.equal(languageForFile("c.unknown"), null)
})

test("LspClient initializes and collects publishDiagnostics", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-lsp-"))
  let client: LspClient | undefined
  try {
    const file = join(dir, "x.ts")
    writeFileSync(file, "const a: number = 1\nconst b = 2\nconst c: number = 'x'\n")
    client = new LspClient(SPEC, dir)
    await client.start()
    assert.equal(client.isInitialized, true)
    const diags = await client.diagnose(file, "const a: number = 1\nconst b = 2\nconst c: number = 'x'\n", 3000)
    assert.equal(diags.length, 1)
    assert.equal(diags[0]!.severity, "error")
    assert.equal(diags[0]!.line, 3)
  } finally {
    try { client?.close() } catch { /* ignore */ }
    // maxRetries/retryDelay handle Windows releasing the child's handles late.
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 })
  }
})

test("LspManager.diagnose reports errors for a supported file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-lspm-"))
  let mgr: LspManager | undefined
  try {
    const file = join(dir, "y.ts")
    writeFileSync(file, "const c: number = 'x'\n")
    mgr = new LspManager(dir, { typescript: SPEC })
    const result = await mgr.diagnose(file)
    assert.equal(result.ok, true)
    assert.equal(result.diagnostics.length, 1)
  } finally {
    try { mgr?.close() } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 })
  }
})

test("LspManager reports unsupported file types", async () => {
  const mgr = new LspManager("/tmp", { typescript: SPEC })
  const result = await mgr.diagnose("/tmp/readme.unknownext")
  assert.equal(result.unsupported, true)
  mgr.close()
})

test("formatDiagnostics renders compact lines", () => {
  const out = formatDiagnostics("x.ts", [
    { severity: "error", line: 3, column: 5, message: "boom", code: 2322 },
  ])
  assert.match(out, /ERROR x\.ts:3:5/)
  assert.match(out, /\[2322\]/)
  assert.equal(formatDiagnostics("ok.ts", []), "ok.ts: no diagnostics ✓")
})
