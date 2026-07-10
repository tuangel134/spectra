import test from "node:test"
import assert from "node:assert/strict"
import { createCoreSpawnSpec } from "../src/core/supervisor.js"
import { parseDaemonArgs } from "../src/core/daemon.js"

test("core supervisor spawns the same Spectra entry point with a versioned daemon command", () => {
  const spec = createCoreSpawnSpec("/tmp/project with spaces", 4545, "/tmp/spectra/dist/cli.js")
  assert.equal(spec.command, process.execPath)
  assert.deepEqual(spec.args, [
    "/tmp/spectra/dist/cli.js",
    "core-daemon",
    "--cwd",
    "/tmp/project with spaces",
    "--port",
    "4545",
  ])
})

test("daemon argument parsing validates ports and preserves paths", () => {
  assert.deepEqual(parseDaemonArgs(["--cwd", "/tmp/a b", "--port", "4555"]), { cwd: "/tmp/a b", port: 4555 })
  assert.throws(() => parseDaemonArgs(["--port", "70000"]), /Invalid --port/)
})
