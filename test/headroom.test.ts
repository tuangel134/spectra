import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { detectContentType } from "../src/headroom/detect.ts"
import { compressJson } from "../src/headroom/json.ts"
import { compressLogs } from "../src/headroom/logs.ts"
import { Headroom } from "../src/headroom/index.ts"
import { estimateTokens } from "../src/session/compaction.ts"
import { headroomRetrieveTool } from "../src/tool/headroom-retrieve.ts"
import type { ToolContext } from "../src/tool/types.ts"

function makeCtx(headroom?: { retrieve(ref: string): string | undefined }): ToolContext {
  return {
    projectRoot: "/tmp",
    agentId: "test",
    requestApproval: async () => true,
    permissionFor: () => "allow",
    report: () => {},
    headroom,
  }
}

const ROWS = JSON.stringify(
  Array.from({ length: 40 }, (_, i) => ({
    id: i,
    name: `user_${i}`,
    email: `user_${i}@example.com`,
    active: i % 2 === 0,
  })),
)

test("detectContentType recognizes JSON", () => {
  assert.equal(detectContentType('{"a":1}'), "json")
  assert.equal(detectContentType("[1,2,3]"), "json")
})

test("detectContentType recognizes logs", () => {
  const logs = [
    "2026-01-01 10:00:00 INFO starting",
    "2026-01-01 10:00:01 INFO connecting",
    "2026-01-01 10:00:02 ERROR connection refused",
    "2026-01-01 10:00:03 WARN retrying",
  ].join("\n")
  assert.equal(detectContentType(logs), "logs")
})

test("detectContentType recognizes code", () => {
  const code = "export function add(a: number, b: number) {\n  const sum = a + b\n  return sum\n}"
  assert.equal(detectContentType(code), "code")
})

test("detectContentType falls back to text", () => {
  assert.equal(detectContentType("just a sentence about nothing in particular"), "text")
})

test("compressJson collapses an array of objects into a table", () => {
  const result = compressJson(ROWS)
  assert.equal(result.changed, true)
  assert.match(result.text, /«table» 40 rows/)
  assert.match(result.text, /columns: id, name, email, active/)
  // The compact table must be meaningfully smaller than the raw JSON.
  assert.ok(result.text.length < ROWS.length, "table should be smaller than raw JSON")
})

test("compressJson default truncates very large arrays (head+tail) but flags the omission", () => {
  const big = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i, v: i * 2 })))
  const result = compressJson(big)
  assert.match(result.text, /«table» 100 rows/)
  assert.match(result.text, /more rows omitted/) // honest marker, recoverable via headroom_retrieve
})

test("compressJson with headRows=∞ is lossless: every row and value is preserved", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, name: "n" + i, v: i * 7 }))
  const result = compressJson(JSON.stringify(rows), { headRows: Number.MAX_SAFE_INTEGER, tailRows: 0 })
  assert.equal(result.changed, true)
  assert.doesNotMatch(result.text, /omitted/)
  // Spot-check that a middle row's exact values survive the compression.
  assert.match(result.text, /\[50\] 50 \| "n50" \| 350/)
  assert.match(result.text, /\[99\] 99 \| "n99" \| 693/)
  // And it is still smaller than the pretty-printed original.
  assert.ok(result.text.length < JSON.stringify(rows, null, 2).length)
})

test("compressJson leaves small arrays alone", () => {
  const small = JSON.stringify([{ a: 1 }, { a: 2 }])
  const result = compressJson(small)
  assert.equal(result.changed, false)
})

test("compressJson handles a wrapper object with a primary array", () => {
  const wrapped = JSON.stringify({ total: 40, page: 1, results: JSON.parse(ROWS) })
  const result = compressJson(wrapped)
  assert.equal(result.changed, true)
  assert.match(result.text, /«meta»/)
  assert.match(result.text, /«field» results:/)
})

test("compressLogs collapses repeated lines and preserves errors", () => {
  const lines = [
    ...Array.from({ length: 50 }, () => "heartbeat ok"),
    "FATAL out of memory at 0xDEADBEEF",
  ].join("\n")
  const result = compressLogs(lines)
  assert.equal(result.changed, true)
  assert.match(result.text, /heartbeat ok {2}\(×50\)/)
  assert.match(result.text, /FATAL out of memory/)
})

test("compressLogs shortens long stack traces", () => {
  const trace = [
    "ERROR boom",
    ...Array.from({ length: 20 }, (_, i) => `    at frame${i} (file.js:${i})`),
  ].join("\n")
  const result = compressLogs(trace)
  assert.match(result.text, /more stack frames/)
  assert.match(result.text, /ERROR boom/)
})

test("compressLogs dedups repeated lines that differ only by timestamp", () => {
  const lines = Array.from(
    { length: 30 },
    (_, i) => `2026-06-27 10:00:${String(i % 60).padStart(2, "0")} INFO heartbeat ok`,
  )
  lines.push("2026-06-27 10:01:00 ERROR upstream timeout")
  const result = compressLogs(lines.join("\n"))
  assert.equal(result.changed, true)
  assert.match(result.text, /\(×30\)/)
  assert.match(result.text, /ERROR upstream timeout/)
})

test("Headroom.compress skips small payloads", () => {
  const hr = new Headroom()
  const result = hr.compress("tiny output")
  assert.equal(result.compressed, false)
})

test("Headroom.compress compresses JSON and is reversible", () => {
  const hr = new Headroom({ minTokens: 10 })
  const result = hr.compress(ROWS)
  assert.equal(result.compressed, true)
  assert.equal(result.type, "json")
  assert.ok(result.compressedTokens < result.originalTokens)
  assert.ok(result.ref, "a reference id should be issued")
  assert.match(result.text, /headroom_retrieve/)
  // The original is recoverable verbatim.
  assert.equal(hr.retrieve(result.ref!), ROWS)
})

test("Headroom.compress passes through when disabled", () => {
  const hr = new Headroom({ enabled: false })
  const result = hr.compress(ROWS)
  assert.equal(result.compressed, false)
  assert.equal(result.text, ROWS)
})

test("Headroom evicts originals beyond maxStored (LRU)", () => {
  const hr = new Headroom({ minTokens: 1, maxStored: 2 })
  const a = hr.compress(ROWS).ref!
  const b = hr.compress(ROWS.replace("user_0", "userZ")).ref!
  const c = hr.compress(ROWS.replace("user_1", "userY")).ref!
  assert.equal(hr.retrieve(a), undefined, "oldest should be evicted")
  assert.ok(hr.retrieve(b))
  assert.ok(hr.retrieve(c))
})

test("headroom_retrieve tool returns the cached original", async () => {
  const hr = new Headroom({ minTokens: 10 })
  const ref = hr.compress(ROWS).ref!
  const result = await headroomRetrieveTool.execute({ ref }, makeCtx(hr))
  assert.equal(result.success, true)
  assert.equal(result.output, ROWS)
})

test("headroom_retrieve tool errors on unknown ref", async () => {
  const hr = new Headroom()
  const result = await headroomRetrieveTool.execute({ ref: "hr_nope" }, makeCtx(hr))
  assert.equal(result.success, false)
  assert.match(result.output, /no cached original/)
})

test("Headroom never inflates a payload past the original (retrieval note counted)", () => {
  const hr = new Headroom({ minTokens: 20 })
  // A small array that compresses only a little: the retrieval note must not
  // push the actually-sent text above the original size.
  const rows = Array.from({ length: 6 }, (_, i) => ({ k: i, label: "x".repeat(20) }))
  const raw = JSON.stringify(rows, null, 2)
  const r = hr.compress(raw)
  if (r.compressed) {
    // Reported "after" size must equal the real sent text…
    assert.equal(r.compressedTokens, estimateTokens(r.text), "stats must count the retrieval note")
    // …and must be a genuine reduction.
    assert.ok(r.compressedTokens < r.originalTokens, "compressed payload must be smaller than the original")
    assert.ok(estimateTokens(r.text) < r.originalTokens, "the text actually sent must be smaller than the original")
  } else {
    // Passing it through unchanged is also acceptable (never inflated).
    assert.equal(r.text, raw)
  }
})

test("reported savings reflect the real sent text for any compressed payload", () => {
  const hr = new Headroom({ minTokens: 10 })
  const r = hr.compress(ROWS)
  assert.equal(r.compressed, true)
  assert.equal(r.compressedTokens, estimateTokens(r.text))
})

test("Headroom persists originals to disk so memory eviction never loses them", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-hr-"))
  try {
    // maxStored:1 forces the first original out of memory immediately.
    const hr = new Headroom({ minTokens: 10, maxStored: 1 }, dir)
    const first = hr.compress(ROWS)
    const second = hr.compress(ROWS.replace("user_0", "userZ"))
    assert.ok(first.ref && second.ref)
    // The first ref was evicted from memory but must still be recoverable from disk.
    assert.equal(hr.retrieve(first.ref!), ROWS, "evicted original recoverable from disk")
    assert.equal(hr.retrieve(second.ref!), ROWS.replace("user_0", "userZ"))
    // A brand-new instance (simulating a restart) still recovers it from disk.
    const reborn = new Headroom({ minTokens: 10 }, dir)
    assert.equal(reborn.retrieve(first.ref!), ROWS, "original survives a process restart")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("JSON table escapes the '|' separator inside values", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: i, expr: `a | b ${i}` }))
  const c = compressJson(JSON.stringify(rows))
  assert.equal(c.changed, true)
  // Pipes inside a value are escaped so they can't be read as column breaks.
  assert.match(c.text, /a \\\| b 0/)
})

test("persist toggle: on = durable across restarts, off = memory-only + purges disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "spectra-hr-"))
  try {
    const hr = new Headroom({ minTokens: 10 }, dir)
    const a = hr.compress(ROWS).ref!
    // Persistence is on by default → a fresh instance (restart) recovers it from disk.
    assert.equal(new Headroom({ minTokens: 10 }, dir).retrieve(a), ROWS)

    // Turn persistence OFF → the on-disk cache is purged.
    hr.configure({ persist: false })
    assert.equal(new Headroom({ minTokens: 10 }, dir).retrieve(a), undefined, "disk purged when persistence disabled")

    // New compressions while off never touch disk.
    const b = hr.compress(ROWS.replace("user_0", "userQ")).ref!
    assert.equal(new Headroom({ minTokens: 10 }, dir).retrieve(b), undefined, "no disk write while persistence is off")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
