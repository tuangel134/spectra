#!/usr/bin/env node
/**
 * Cross-platform test runner.
 *
 * `node --test ./test/*.test.ts` relies on the SHELL expanding the glob, which
 * cmd.exe on Windows does not do. This script enumerates the test files itself
 * (portable) and hands them to Node's built-in test runner with the tsx loader.
 */

import { readdirSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const testDir = join(root, "test")

const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => join("test", f))

if (files.length === 0) {
  console.error("No test files found in test/")
  process.exit(1)
}

const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--import", "tsx", ...files], {
  cwd: root,
  stdio: "inherit",
})

process.exit(result.status ?? 1)
