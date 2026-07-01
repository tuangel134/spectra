import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { detectVerifyCommands, scanForSkeletons, collectSourceFiles, findTestFiles, comprehensiveTestCommand, scanStructuralIssues } from "../src/autorun/verify.ts"
import { StallDetector, progressSignature, errorDigest } from "../src/autorun/stall.ts"
import { Watchdog } from "../src/autorun/watchdog.ts"
import { AutorunStore } from "../src/autorun/state.ts"

function withTempDir(fn: (dir: string) => void): () => void {
  return () => {
    const dir = mkdtempSync(join(tmpdir(), "spectra-autorun-"))
    try {
      fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

// ── verify: command detection ──────────────────────────────────────────────

test(
  "detectVerifyCommands reads package.json scripts in fail-fast order",
  withTempDir((dir) => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", lint: "eslint .", test: "node --test", dev: "x" } }),
    )
    const cmds = detectVerifyCommands(dir)
    assert.deepEqual(cmds, ["npm run build --silent", "npm run lint --silent", "npm run test --silent"])
  }),
)

test(
  "detectVerifyCommands honors an explicit list",
  withTempDir((dir) => {
    assert.deepEqual(detectVerifyCommands(dir, ["make check"]), ["make check"])
  }),
)

test(
  "detectVerifyCommands falls back to ecosystem defaults",
  withTempDir((dir) => {
    writeFileSync(join(dir, "Cargo.toml"), "[package]\nname='x'")
    assert.deepEqual(detectVerifyCommands(dir), ["cargo fmt -- --check", "cargo build", "cargo test"])
  }),
)

// ── verify: skeleton gate ──────────────────────────────────────────────────

test("scanForSkeletons flags placeholder markers", () => {
  const files = {
    "src/a.ts": "export function done() { return 1 }",
    "src/b.ts": "function x() {\n  // TODO: implement this\n}",
    "src/c.py": "def handler():\n    raise NotImplementedError",
  }
  const violations = scanForSkeletons(files)
  const flagged = violations.map((v) => v.file).sort()
  assert.deepEqual(flagged, ["src/b.ts", "src/c.py"])
})

test("scanForSkeletons ignores markdown and build artifacts", () => {
  const files = {
    "README.md": "TODO: write docs",
    "dist/bundle.js": "// TODO leftover",
    "src/ok.ts": "const y = 2",
  }
  assert.deepEqual(scanForSkeletons(files), [])
})

test(
  "collectSourceFiles walks the tree and skips node_modules",
  withTempDir((dir) => {
    mkdirSync(join(dir, "src"))
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true })
    writeFileSync(join(dir, "src", "main.ts"), "export const a = 1")
    writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = 1")
    const files = collectSourceFiles(dir)
    const keys = Object.keys(files)
    assert.ok(keys.includes("src/main.ts"))
    assert.ok(!keys.some((k) => k.includes("node_modules")))
  }),
)

// ── verify: full-suite test discovery ──────────────────────────────────────

test(
  "findTestFiles discovers test files across multiple directories",
  withTempDir((dir) => {
    mkdirSync(join(dir, "test"))
    mkdirSync(join(dir, "tests"))
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true })
    writeFileSync(join(dir, "test", "a.test.js"), "import 'node:test'")
    writeFileSync(join(dir, "tests", "b.test.js"), "import 'node:test'")
    writeFileSync(join(dir, "node_modules", "pkg", "c.test.js"), "import 'node:test'")
    const files = findTestFiles(dir).sort()
    assert.deepEqual(files, ["test/a.test.js", "tests/b.test.js"])
  }),
)

test(
  "comprehensiveTestCommand returns node --test for node:test suites",
  withTempDir((dir) => {
    writeFileSync(join(dir, "x.test.js"), "import { test } from 'node:test'")
    assert.equal(comprehensiveTestCommand(dir), "node --test")
  }),
)

test(
  "comprehensiveTestCommand returns null for non-node:test runners",
  withTempDir((dir) => {
    writeFileSync(join(dir, "x.test.js"), "import { describe } from 'vitest'")
    assert.equal(comprehensiveTestCommand(dir), null)
  }),
)

test(
  "detectVerifyCommands appends a full-suite run when the test script under-globs",
  withTempDir((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test test/*.test.js" } }))
    mkdirSync(join(dir, "tests"))
    writeFileSync(join(dir, "tests", "extra.test.js"), "import 'node:test'")
    const cmds = detectVerifyCommands(dir)
    assert.deepEqual(cmds, ["npm run test --silent", "node --test"])
  }),
)

// ── verify: structural duplicate detection ─────────────────────────────────

test(
  "scanStructuralIssues flags parallel test directories as blocking",
  withTempDir((dir) => {
    mkdirSync(join(dir, "test"))
    mkdirSync(join(dir, "tests"))
    const issues = scanStructuralIssues(dir)
    const block = issues.find((i) => i.kind === "parallel-test-dirs")
    assert.ok(block, "should detect parallel test dirs")
    assert.equal(block!.blocking, true)
  }),
)

test(
  "scanStructuralIssues flags duplicate modules in the same directory",
  withTempDir((dir) => {
    mkdirSync(join(dir, "src", "controllers"), { recursive: true })
    writeFileSync(join(dir, "src", "controllers", "budgets.js"), "module.exports = {}")
    writeFileSync(join(dir, "src", "controllers", "budgetController.js"), "module.exports = {}")
    const issues = scanStructuralIssues(dir)
    const dup = issues.find((i) => i.kind === "duplicate-module")
    assert.ok(dup, "should detect budget duplicate")
    assert.equal(dup!.blocking, false)
    assert.match(dup!.detail, /budget/)
  }),
)

test(
  "scanStructuralIssues is quiet on a clean single-suite project",
  withTempDir((dir) => {
    mkdirSync(join(dir, "src"), { recursive: true })
    mkdirSync(join(dir, "test"), { recursive: true })
    writeFileSync(join(dir, "src", "server.js"), "module.exports = {}")
    writeFileSync(join(dir, "src", "router.js"), "module.exports = {}")
    writeFileSync(join(dir, "test", "server.test.js"), "import 'node:test'")
    assert.deepEqual(scanStructuralIssues(dir), [])
  }),
)

// ── anti-stall ──────────────────────────────────────────────────────────────

test("StallDetector trips after the threshold of identical signatures", () => {
  const d = new StallDetector(3)
  assert.equal(d.record("a").stalled, false) // count 0
  assert.equal(d.record("a").stalled, false) // count 1
  assert.equal(d.record("a").stalled, false) // count 2
  assert.equal(d.record("a").stalled, true) // count 3 -> stalled
})

test("StallDetector resets the counter when progress changes the signature", () => {
  const d = new StallDetector(2)
  d.record("a")
  d.record("a")
  const v = d.record("b") // signature changed -> progress
  assert.equal(v.stalled, false)
  assert.equal(v.count, 0)
})

test("progressSignature is stable for identical inputs and varies otherwise", () => {
  const base = { phase: 1, phasesCompleted: 1, lastErrorDigest: "x" }
  assert.equal(progressSignature(base), progressSignature({ ...base }))
  // A different error, phase, or completed-count is real progress/change.
  assert.notEqual(progressSignature(base), progressSignature({ ...base, lastErrorDigest: "y" }))
  assert.notEqual(progressSignature(base), progressSignature({ ...base, phase: 2 }))
  assert.notEqual(progressSignature(base), progressSignature({ ...base, phasesCompleted: 2 }))
})

test("errorDigest normalizes volatile tokens so cosmetic diffs match", () => {
  const a = errorDigest("Error at 0xAB12: timeout after 30 ms")
  const b = errorDigest("Error at 0xFF99: timeout after 45 ms")
  assert.equal(a, b)
  assert.notEqual(a, errorDigest("totally different failure"))
})

// ── watchdog ──────────────────────────────────────────────────────────────

test("Watchdog fires onStale when no beat arrives in time", async () => {
  let firedWith = 0
  const wd = new Watchdog({ staleMs: 30, checkIntervalMs: 10, onStale: (since) => (firedWith = since) })
  wd.start()
  await new Promise((r) => setTimeout(r, 80))
  wd.stop()
  assert.ok(firedWith >= 30, "should report time since last beat")
})

test("Watchdog does not fire while beats keep arriving", async () => {
  let fired = false
  const wd = new Watchdog({ staleMs: 40, checkIntervalMs: 10, onStale: () => (fired = true) })
  wd.start()
  const beater = setInterval(() => wd.beat(), 10)
  await new Promise((r) => setTimeout(r, 90))
  clearInterval(beater)
  wd.stop()
  assert.equal(fired, false)
})

// ── state persistence / checkpoints ──────────────────────────────────────────

test(
  "AutorunStore checkpoints and reloads run state",
  withTempDir((dir) => {
    const store = new AutorunStore(dir)
    const state = store.create("build a todo app")
    state.phases = [{ index: 0, title: "p1", taskIds: [1], status: "completed", reviewPasses: 1 }]
    state.currentPhase = 1
    store.save(state)

    const reloaded = store.load(state.id)
    assert.ok(reloaded)
    assert.equal(reloaded!.goal, "build a todo app")
    assert.equal(reloaded!.phases[0]!.status, "completed")
  }),
)

test(
  "AutorunStore.latestResumable returns only unfinished runs",
  withTempDir((dir) => {
    const store = new AutorunStore(dir)
    const a = store.create("first")
    a.finished = true
    store.save(a)
    const b = store.create("second")
    store.save(b)
    const resumable = store.latestResumable()
    assert.ok(resumable)
    assert.equal(resumable!.id, b.id)
  }),
)

test(
  "AutorunStore.pushEvent appends bounded events",
  withTempDir((dir) => {
    const store = new AutorunStore(dir)
    const s = store.create("x")
    store.pushEvent(s, "phase", "started")
    store.pushEvent(s, "success", "done")
    assert.equal(s.events.length, 2)
    assert.equal(s.events[0]!.level, "phase")
    assert.equal(s.events[1]!.message, "done")
  }),
)
