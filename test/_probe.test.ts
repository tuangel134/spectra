import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createRuntime } from "../src/runtime.ts"
import { createServer } from "../src/server/index.ts"

const GETS = [
  "/api/commands", "/api/specs", "/api/files", "/api/logs", "/api/permissions",
  "/api/tools", "/api/hooks", "/api/steering", "/api/mcp", "/api/skills",
  "/api/mcp/legacy", "/api/memory", "/api/plugins", "/api/cost", "/api/timeline",
  "/api/memory/entries", "/api/audit", "/api/projects", "/api/github", "/api/autorun",
  "/api/settings", "/api/headroom", "/api/routing", "/api/state", "/api/session", "/api/catalog",
]

const POSTS: [string, unknown][] = [
  ["/api/clear", {}],
  ["/api/settings/supervise", { on: false }],
  ["/api/settings/spec", { detect: "off" }],
  ["/api/settings/headroom", { enabled: true }],
  ["/api/settings/compaction", { auto: true }],
  ["/api/settings/autorun", { parallel: true }],
  ["/api/permission", { tool: "bash", level: "allow" }],
  ["/api/routing", { mode: "manual" }],
  ["/api/spec/detect", { message: "build me a todo app with a rest api" }],
  ["/api/fs/tree", {}],
  ["/api/memory/forget", { id: "does-not-exist" }],
  ["/api/timeline/restore", { id: "does-not-exist" }],
]

test("QA probe: every GET endpoint returns 200 + valid JSON", async () => {
  const project = mkdtempSync(join(tmpdir(), "spectra-probe-"))
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "t", scripts: { test: "echo ok" } }))
  mkdirSync(join(project, "src"), { recursive: true })
  writeFileSync(join(project, "src", "index.js"), "export const x = 1\n")
  const rt = createRuntime({ cwd: project })
  const srv = createServer(rt, { port: 4120, hostname: "127.0.0.1", cors: [], noAuth: true })
  await srv.listen()
  const base = "http://127.0.0.1:4120"
  const failures: string[] = []
  try {
    for (const path of GETS) {
      try {
        const res = await fetch(base + path)
        if (!res.ok) { failures.push(`${path} -> HTTP ${res.status}`); continue }
        await res.json()
      } catch (err) {
        failures.push(`${path} -> ${(err as Error).message}`)
      }
    }
    assert.equal(failures.length, 0, "GET failures:\n" + failures.join("\n"))
  } finally {
    await srv.close()
    rmSync(project, { recursive: true, force: true })
  }
})

test("QA probe: safe POST endpoints don't 500", async () => {
  const project = mkdtempSync(join(tmpdir(), "spectra-probe2-"))
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "t" }))
  const rt = createRuntime({ cwd: project })
  const srv = createServer(rt, { port: 4121, hostname: "127.0.0.1", cors: [], noAuth: true })
  await srv.listen()
  const base = "http://127.0.0.1:4121"
  const failures: string[] = []
  try {
    for (const [path, body] of POSTS) {
      try {
        const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        if (res.status >= 500) { failures.push(`${path} -> HTTP ${res.status}`); continue }
        // Body should be JSON.
        await res.json()
      } catch (err) {
        failures.push(`${path} -> ${(err as Error).message}`)
      }
    }
    assert.equal(failures.length, 0, "POST failures:\n" + failures.join("\n"))
  } finally {
    await srv.close()
    rmSync(project, { recursive: true, force: true })
  }
})

test("QA probe: hooks + steering create/delete roundtrip", async () => {
  const project = mkdtempSync(join(tmpdir(), "spectra-probe3-"))
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "t" }))
  const rt = createRuntime({ cwd: project })
  const srv = createServer(rt, { port: 4122, hostname: "127.0.0.1", cors: [], noAuth: true })
  await srv.listen()
  const base = "http://127.0.0.1:4122"
  const jp = (p: string, b: unknown) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })
  try {
    let r = await jp("/api/hooks", { name: "probehook", event: "promptSubmit", action: "runCommand", command: "echo hi" })
    assert.ok(r.status < 500, "create hook")
    let list = (await (await fetch(base + "/api/hooks")).json()) as { hooks?: unknown[] }
    assert.ok((list.hooks || []).length >= 1, "hook should appear in the list")
    r = await jp("/api/steering", { name: "probesteer", content: "# rule" })
    assert.ok(r.status < 500, "create steering")
    const steer = (await (await fetch(base + "/api/steering")).json()) as { steering?: unknown[] }
    assert.ok((steer.steering || []).length >= 1, "steering should appear")
  } finally {
    await srv.close()
    rmSync(project, { recursive: true, force: true })
  }
})
