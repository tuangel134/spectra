import { test } from "node:test"
import assert from "node:assert/strict"
import { Readable, Writable } from "node:stream"

import { Repl } from "../src/tui/repl.ts"
import { createRuntime } from "../src/runtime.ts"

/**
 * Stability regression: the REPL must exit cleanly when its input stream ends
 * (pipe / EOF / non-TTY), not hang forever.
 */
test("REPL exits when stdin closes (EOF)", async () => {
  const input = Readable.from(["/help\n"]) // emits one line then ends
  const output = new Writable({ write(_c, _e, cb) { cb() } })
  const rt = createRuntime()
  const repl = new Repl(rt, { input, output })

  // If the REPL hangs, this race rejects after 5s and the test fails.
  const exited = repl.start().then(() => "exited")
  const timeout = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("REPL hung on EOF")), 5000))

  const result = await Promise.race([exited, timeout])
  assert.equal(result, "exited")
})

test("REPL exits immediately on an already-empty stream", async () => {
  const input = Readable.from([]) // ends immediately
  const output = new Writable({ write(_c, _e, cb) { cb() } })
  const rt = createRuntime()
  const repl = new Repl(rt, { input, output })

  const exited = repl.start().then(() => true)
  const timeout = new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error("hung")), 5000))
  assert.equal(await Promise.race([exited, timeout]), true)
})
