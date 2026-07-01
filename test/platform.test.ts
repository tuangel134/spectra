import { test } from "node:test"
import assert from "node:assert/strict"
import { homedir } from "node:os"
import { join } from "node:path"

import { shellFor, configDirFor, configDir, isAbsolutePath, IS_WINDOWS } from "../src/util/platform.ts"

test("shellFor wraps a command in the right shell for the current OS", () => {
  const { file, args } = shellFor("echo hi")
  if (IS_WINDOWS) {
    assert.match(file.toLowerCase(), /cmd/)
    assert.deepEqual(args, ["/d", "/s", "/c", "echo hi"])
  } else {
    // Honours $SHELL, falling back to /bin/bash, always with -c <command>.
    assert.equal(args[0], "-c")
    assert.equal(args[1], "echo hi")
    assert.ok(file.length > 0)
  }
})

test("configDirFor respects XDG_CONFIG_HOME on POSIX, else ~/.config", () => {
  if (IS_WINDOWS) {
    // On Windows it lands under APPDATA (or the roaming fallback).
    const p = configDirFor("spectra")
    assert.match(p, /spectra$/)
    return
  }
  const prev = process.env["XDG_CONFIG_HOME"]
  try {
    process.env["XDG_CONFIG_HOME"] = "/tmp/xdg-test"
    assert.equal(configDirFor("spectra"), "/tmp/xdg-test/spectra")
    delete process.env["XDG_CONFIG_HOME"]
    assert.equal(configDirFor("spectra"), join(homedir(), ".config", "spectra"))
  } finally {
    if (prev === undefined) delete process.env["XDG_CONFIG_HOME"]
    else process.env["XDG_CONFIG_HOME"] = prev
  }
})

test("configDir is configDirFor('spectra')", () => {
  assert.equal(configDir(), configDirFor("spectra"))
})

test("isAbsolutePath recognizes POSIX and (on Windows) drive-absolute paths", () => {
  assert.equal(isAbsolutePath("/etc/hosts"), true)
  assert.equal(isAbsolutePath("relative/path"), false)
  assert.equal(isAbsolutePath("./x"), false)
  // Drive-absolute is only treated as absolute on Windows.
  assert.equal(isAbsolutePath("C:\\Users\\me"), IS_WINDOWS)
})
