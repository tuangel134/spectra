#!/usr/bin/env node
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const project = await mkdtemp(join(tmpdir(), "spectra-e2e-"))
const port = await new Promise((resolve, reject) => { const server = createServer(); server.on("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const selected = typeof address === "object" && address ? address.port : 0; server.close((error) => error ? reject(error) : resolve(selected)) }) })
await writeFile(join(project, "package.json"), JSON.stringify({ name: "spectra-e2e-project", private: true }))
const child = spawn(process.execPath, [join(root, "dist", "cli.js"), "core-daemon", "--cwd", project, "--port", String(port)], { cwd: project, stdio: ["ignore", "pipe", "pipe"] })
let logs = ""
child.stdout.on("data", (chunk) => { logs += chunk })
child.stderr.on("data", (chunk) => { logs += chunk })
async function waitHealth() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/health`); if (response.ok) return response.json() } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Core did not become ready:\n${logs}`)
}
try {
  const health = await waitHealth()
  if (health.version !== "1.0.0" || !health.token) throw new Error("Unexpected health response")
  const desktop = await fetch(`http://127.0.0.1:${port}/desktop`).then((response) => response.text())
  if (!desktop.includes("Production readiness") || /<script[^>]+src=/i.test(desktop)) throw new Error("Desktop production shell failed E2E policy")
  const status = await fetch(`http://127.0.0.1:${port}/api/production/status`, { headers: { authorization: `Bearer ${health.token}` } }).then((response) => response.json())
  if (status.version !== "1.0.0" || !Array.isArray(status.checks)) throw new Error("Production status endpoint failed")
  console.log("Spectra production E2E smoke passed.")
} finally {
  child.kill("SIGTERM")
  await new Promise((resolve) => setTimeout(resolve, 200))
  if (!child.killed) child.kill("SIGKILL")
  await rm(project, { recursive: true, force: true })
}
