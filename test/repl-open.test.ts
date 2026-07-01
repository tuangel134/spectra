import { test } from "node:test"
import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Repl } from "../src/tui/repl.ts"
import { createRuntime } from "../src/runtime.ts"
import { SessionManager } from "../src/session/manager.ts"

function seedProject(dir: string, text: string): string {
  writeFileSync(join(dir, "spectra.jsonc"), "{}")
  const sm = new SessionManager()
  sm.enablePersistence(dir)
  const s = sm.create("build", "free/deepseek-v4-flash-free")
  sm.addMessage(s.id, { role: "user", content: text })
  sm.flush()
  return s.id
}

function driveRepl(rt: ReturnType<typeof createRuntime>, lines: string[]): Promise<string> {
  const input = new PassThrough()
  const output = new PassThrough()
  let captured = ""
  output.on("data", (c) => (captured += c.toString()))
  const repl = new Repl(rt, { input, output })
  const done = repl.start().then(() => captured)
  let i = 0
  const feed = (): void => {
    if (i < lines.length) {
      input.write(lines[i] + "\n")
      i++
      setTimeout(feed, 30)
    } else setTimeout(() => input.end(), 30)
  }
  setTimeout(feed, 30)
  return done
}

test("REPL /open switches to another project and resumes its session", async () => {
  const home = mkdtempSync(join(tmpdir(), "spectra-home-"))
  const A = mkdtempSync(join(tmpdir(), "spectra-openA-"))
  const B = mkdtempSync(join(tmpdir(), "spectra-openB-"))
  const prevHome = process.env["HOME"]
  const prevXdg = process.env["XDG_CONFIG_HOME"]
  const prevAppData = process.env["APPDATA"]
  process.env["HOME"] = home
  process.env["XDG_CONFIG_HOME"] = join(home, ".config")
  process.env["APPDATA"] = join(home, "AppData", "Roaming")
  try {
    seedProject(A, "alpha task")
    const idB = seedProject(B, "beta task")

    const rt = createRuntime({ cwd: A })
    assert.equal(rt.config.projectRoot, A)

    const out = await driveRepl(rt, [`/open ${B}`, "/exit"])

    assert.equal(rt.config.projectRoot, B, "runtime should now point at project B")
    assert.equal(rt.sessions.resumable()?.id, idB, "B's session should be resumable/current")
    assert.match(out, /Opened/)
  } finally {
    if (prevHome !== undefined) process.env["HOME"] = prevHome
    else delete process.env["HOME"]
    if (prevXdg !== undefined) process.env["XDG_CONFIG_HOME"] = prevXdg
    else delete process.env["XDG_CONFIG_HOME"]
    if (prevAppData !== undefined) process.env["APPDATA"] = prevAppData
    else delete process.env["APPDATA"]
    rmSync(home, { recursive: true, force: true })
    rmSync(A, { recursive: true, force: true })
    rmSync(B, { recursive: true, force: true })
  }
})
