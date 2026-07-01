import { test } from "node:test"
import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Repl } from "../src/tui/repl.ts"
import { createRuntime } from "../src/runtime.ts"
import { parseJsonc } from "../src/config/loader.ts"

/**
 * Drive the REPL like a real user typing answers, feeding lines on the input
 * stream one at a time so readline pairs each question with its answer.
 */
function driveRepl(rt: ReturnType<typeof createRuntime>, lines: string[]): Promise<string> {
  const input = new PassThrough()
  const output = new PassThrough()
  let captured = ""
  output.on("data", (chunk) => (captured += chunk.toString()))

  const repl = new Repl(rt, { input, output })
  const done = repl.start().then(() => captured)

  let i = 0
  const feed = (): void => {
    if (i < lines.length) {
      input.write(lines[i] + "\n")
      i++
      setTimeout(feed, 15)
    } else {
      setTimeout(() => input.end(), 15)
    }
  }
  setTimeout(feed, 15)

  return done
}

function withIsolatedHome(
  fn: (ctx: { home: string; project: string }) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const home = mkdtempSync(join(tmpdir(), "spectra-home-"))
    const project = mkdtempSync(join(tmpdir(), "spectra-proj-"))
    const prevHome = process.env["HOME"]
    const prevKey = process.env["OPENCODE_API_KEY"]
    process.env["HOME"] = home
    delete process.env["OPENCODE_API_KEY"]
    try {
      await fn({ home, project })
    } finally {
      if (prevHome !== undefined) process.env["HOME"] = prevHome
      if (prevKey !== undefined) process.env["OPENCODE_API_KEY"] = prevKey
      else delete process.env["OPENCODE_API_KEY"]
      rmSync(home, { recursive: true, force: true })
      rmSync(project, { recursive: true, force: true })
    }
  }
}

test(
  "startup does not prompt for anything; /exit alone is enough",
  withIsolatedHome(async ({ home, project }) => {
    const rt = createRuntime({ cwd: project })
    const output = await driveRepl(rt, ["/exit"])

    // It opened and exited without demanding any input.
    assert.ok(output.includes("Spectra"))

    // A free model is active out of the box, so no provider is required.
    assert.equal(rt.providers.hasCredentials("free"), true)

    // No config was written just by opening the app.
    const globalConfig = join(home, ".config", "spectra", "spectra.jsonc")
    assert.equal(existsSync(globalConfig), false)
  }),
)

test(
  "/connect is optional and persists the key when invoked",
  withIsolatedHome(async ({ home, project }) => {
    const rt = createRuntime({ cwd: project })
    // User chooses to connect: provider 1 (Zen), pastes key, accepts model, exits.
    await driveRepl(rt, ["/connect", "1", "sk-mi-suscripcion-zen", "y", "/exit"])

    const globalConfig = join(home, ".config", "spectra", "spectra.jsonc")
    assert.ok(existsSync(globalConfig), "global config should be written after /connect")
    const saved = parseJsonc(readFileSync(globalConfig, "utf-8")) as {
      provider: { opencode: { options: { apiKey: string } } }
    }
    assert.equal(saved.provider.opencode.options.apiKey, "sk-mi-suscripcion-zen")
    assert.equal(rt.providers.hasCredentials("opencode"), true)
  }),
)

test(
  "/model switches and persists the active model",
  withIsolatedHome(async ({ home, project }) => {
    const rt = createRuntime({ cwd: project })
    await driveRepl(rt, ["/model opencode/claude-opus-4-8", "/exit"])

    assert.equal(rt.config.config.model, "opencode/claude-opus-4-8")
    const saved = parseJsonc(
      readFileSync(join(home, ".config", "spectra", "spectra.jsonc"), "utf-8"),
    ) as { model: string }
    assert.equal(saved.model, "opencode/claude-opus-4-8")
  }),
)
