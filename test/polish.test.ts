import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { scanForSkeletons, projectSnapshot } from "../src/autorun/verify.ts"
import { parsePolishVerdict, polishPrompt } from "../src/autorun/polish.ts"

test("skeleton scan flags expanded placeholder markers", () => {
  const v = scanForSkeletons({
    "a.ts": "const x = 'lorem ipsum dolor sit amet'",
    "b.ts": "const data = [] // dummy data for now",
    "c.ts": "// TBD: wire this",
    "d.py": "def f():\n    raise NotImplementedError",
    "ok.ts": "export const add = (a:number,b:number) => a+b",
  })
  const flagged = v.map((x) => x.file).sort()
  assert.deepEqual(flagged, ["a.ts", "b.ts", "c.ts", "d.py"])
})

test("skeleton scan still passes genuinely complete code", () => {
  assert.deepEqual(
    scanForSkeletons({ "x.ts": "export function sum(ns:number[]){ return ns.reduce((a,b)=>a+b,0) }" }),
    [],
  )
})

test("parsePolishVerdict: PASS means complete", () => {
  assert.equal(parsePolishVerdict("PASS").ok, true)
  assert.equal(parsePolishVerdict("PASS — looks complete and polished.").ok, true)
  assert.equal(parsePolishVerdict("").ok, true) // empty reply never blocks delivery
})

test("parsePolishVerdict: FAIL collects concrete deficiencies", () => {
  const v = parsePolishVerdict("FAIL\n1. The UI is unstyled and empty\n2. No tests for the API\n3. Backend lacks validation")
  assert.equal(v.ok, false)
  assert.equal(v.issues.length, 3)
  assert.match(v.issues[0]!, /unstyled/)
})

test("parsePolishVerdict: a reply that mentions FAIL anywhere is not a pass", () => {
  assert.equal(parsePolishVerdict("Mostly good but FAIL: the login page is a placeholder").ok, false)
})

test("polishPrompt embeds the goal and the snapshot", () => {
  const p = polishPrompt("build a todo app", "Files (1):\nsrc/app.ts")
  assert.match(p, /build a todo app/)
  assert.match(p, /src\/app\.ts/)
  assert.match(p, /COMPLETE and POLISHED/)
})

test("projectSnapshot lists files and samples key files", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-snap-"))
  try {
    mkdirSync(join(dir, "src"))
    writeFileSync(join(dir, "src", "app.ts"), "export const app = () => 'hi'")
    writeFileSync(join(dir, "src", "util.ts"), "export const u = 1")
    const snap = projectSnapshot(dir)
    assert.match(snap, /Files \(2\)/)
    assert.match(snap, /src\/app\.ts/)
    assert.match(snap, /export const app/) // app.ts is sampled (key file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
