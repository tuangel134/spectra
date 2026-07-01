import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { scanSecrets, securityScanTool } from "../src/tool/security.ts"
import type { ToolContext } from "../src/tool/types.ts"

test("scanSecrets flags real secrets and ignores env/placeholder refs", () => {
  const findings = scanSecrets({
    "aws.ts": 'const k = "AKIA1234567890ABCDEF"',
    "key.pem": "-----BEGIN RSA PRIVATE KEY-----\nabc",
    "hard.ts": 'const password = "hunter2hunter2"',
    "env.ts": 'const password = process.env.PASSWORD',
    "placeholder.ts": 'const apiKey = "your-api-key-here"',
    "ok.ts": "export const sum = (a:number,b:number) => a+b",
  })
  const byFile = findings.map((f) => f.file).sort()
  assert.ok(byFile.includes("aws.ts"))
  assert.ok(byFile.includes("key.pem"))
  assert.ok(byFile.includes("hard.ts"))
  assert.ok(!byFile.includes("env.ts"), "env reference is not a hardcoded secret")
  assert.ok(!byFile.includes("placeholder.ts"), "placeholder is not a hardcoded secret")
  assert.ok(!byFile.includes("ok.ts"))
})

test("security_scan tool writes a report and counts secret findings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-sec-"))
  try {
    mkdirSync(join(dir, "src"))
    writeFileSync(join(dir, "src", "config.ts"), 'export const token = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"')
    const ctx: ToolContext = {
      projectRoot: dir, agentId: "security",
      requestApproval: async () => true, permissionFor: () => "allow", report: () => {},
    }
    const r = await securityScanTool.execute({}, ctx)
    assert.equal(r.success, true)
    assert.equal((r.metadata as { secrets: number }).secrets, 1)
    assert.match(r.output, /GitHub token/)
    assert.ok(existsSync(join(dir, ".spectra", "security-report.md")), "report file written")
    assert.match(readFileSync(join(dir, ".spectra", "security-report.md"), "utf-8"), /Security scan/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
