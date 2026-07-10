import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { buildProjectTree, languageForPath, parseGitStatus, resolveProjectPath } from "../src/ide/service.js"

test("resolveProjectPath keeps editor access inside the project", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-ide-path-"))
  assert.equal(resolveProjectPath(root, "src/index.ts").rel, "src/index.ts")
  assert.throws(() => resolveProjectPath(root, "../secret.txt"), /outside project/)
})

test("buildProjectTree sorts directories first and skips generated directories", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-ide-tree-"))
  mkdirSync(join(root, "src"))
  mkdirSync(join(root, "node_modules"))
  writeFileSync(join(root, "z.txt"), "z")
  writeFileSync(join(root, "src", "index.ts"), "export {}")
  writeFileSync(join(root, "node_modules", "ignored.js"), "x")
  const tree = buildProjectTree(root)
  assert.equal(tree[0]?.name, "src")
  assert.equal(tree.some((node) => node.name === "node_modules"), false)
  assert.equal(tree[0]?.children?.[0]?.path, "src/index.ts")
})

test("buildProjectTree does not follow symlinks outside the workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-ide-link-"))
  const outside = mkdtempSync(join(tmpdir(), "spectra-ide-outside-"))
  writeFileSync(join(outside, "secret.txt"), "secret")
  symlinkSync(outside, join(root, "linked"), "dir")
  const tree = buildProjectTree(root)
  assert.equal(tree.some((node) => node.name === "linked"), false)
})

test("parseGitStatus returns branch and file states", () => {
  const parsed = parseGitStatus("## feature/ide...origin/feature/ide\n M src/app.ts\nA  src/new.ts\n?? notes.md\n")
  assert.equal(parsed.branch, "feature/ide")
  assert.deepEqual(parsed.entries.map((entry) => entry.path), ["src/app.ts", "src/new.ts", "notes.md"])
  assert.equal(parsed.entries[0]?.worktree, "M")
})

test("languageForPath covers common desktop IDE languages", () => {
  assert.equal(languageForPath("src/app.tsx"), "typescriptreact")
  assert.equal(languageForPath("Cargo.toml"), "toml")
  assert.equal(languageForPath("README.md"), "markdown")
  assert.equal(languageForPath("unknown.bin"), "plaintext")
})
