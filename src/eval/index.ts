/**
 * Eval harness.
 *
 * A reproducible scorecard for the capabilities that set Spectra apart. Cases
 * are deterministic by default (no network), so `spectra eval` always runs and
 * gives a comparable number across changes. Optional agent scenarios run only
 * when a provider is reachable.
 */

import { Headroom } from "../headroom/index.js"
import { scanForSkeletons } from "../autorun/verify.js"
import { parseTasks, serializeTasks } from "../spec/parser.js"
import { estimateTokens } from "../session/compaction.js"

export interface EvalResult {
  name: string
  pass: boolean
  /** 0..1 quality score. */
  score: number
  detail: string
}

export interface EvalReport {
  results: EvalResult[]
  passed: number
  total: number
  averageScore: number
}

export type EvalCase = () => EvalResult | Promise<EvalResult>

/** Headroom must compress a realistic JSON tool output by a wide margin. */
const evalCompression: EvalCase = () => {
  const hr = new Headroom({ minTokens: 20 })
  const rows = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    path: `src/file_${i}.ts`,
    line: i * 2,
    symbol: `handler_${i}`,
  }))
  const raw = JSON.stringify(rows, null, 2)
  const r = hr.compress(raw)
  const ratio = r.originalTokens > 0 ? 1 - r.compressedTokens / r.originalTokens : 0
  return {
    name: "headroom/json-compression",
    pass: r.compressed && ratio >= 0.5 && hr.retrieve(r.ref!) === raw,
    score: Math.min(1, Math.max(0, ratio)),
    detail: `compressed ${r.originalTokens}→${r.compressedTokens} tok (${Math.round(ratio * 100)}%), reversible=${hr.retrieve(r.ref!) === raw}`,
  }
}

/** Headroom must collapse repetitive logs while preserving errors. */
const evalLogCompression: EvalCase = () => {
  const hr = new Headroom({ minTokens: 20 })
  const lines = Array.from({ length: 100 }, (_, i) => `2026-06-27 10:00:${String(i % 60).padStart(2, "0")} INFO ping ok`)
  lines.push("2026-06-27 10:01:00 ERROR upstream down")
  const raw = lines.join("\n")
  const r = hr.compress(raw)
  const ratio = r.originalTokens > 0 ? 1 - r.compressedTokens / r.originalTokens : 0
  const preserved = (hr.retrieve(r.ref!) ?? "").includes("ERROR upstream down")
  return {
    name: "headroom/log-compression",
    pass: r.compressed && ratio >= 0.6 && preserved,
    score: Math.min(1, Math.max(0, ratio)),
    detail: `ratio=${Math.round(ratio * 100)}%, error-preserved=${preserved}`,
  }
}

/** The no-skeleton gate must catch placeholder code and pass clean code. */
const evalSkeletonGate: EvalCase = () => {
  const dirty = scanForSkeletons({ "a.ts": "function x(){ /* TODO: implement */ }" })
  const clean = scanForSkeletons({ "b.ts": "export const add=(a:number,b:number)=>a+b" })
  const pass = dirty.length === 1 && clean.length === 0
  return {
    name: "autorun/skeleton-gate",
    pass,
    score: pass ? 1 : 0,
    detail: `flagged dirty=${dirty.length}, flagged clean=${clean.length}`,
  }
}

/** The spec task parser must round-trip without losing data. */
const evalSpecRoundTrip: EvalCase = () => {
  const md = serializeTasks("Demo", [
    { id: 1, title: "Set up", description: "init", status: "pending", dependencies: [], files: ["a.ts"], validation: "build" },
    { id: 2, title: "Build", description: "impl", status: "pending", dependencies: [1], files: [], validation: "test" },
  ])
  const tasks = parseTasks(md)
  const pass = tasks.length === 2 && tasks[1]!.dependencies.includes(1)
  return {
    name: "spec/parser-roundtrip",
    pass,
    score: pass ? 1 : 0,
    detail: `parsed ${tasks.length} tasks, deps preserved=${tasks[1]?.dependencies.includes(1)}`,
  }
}

/** The token estimator must be in a sane range for known text. */
const evalTokenEstimator: EvalCase = () => {
  const text = "The quick brown fox jumps over the lazy dog. ".repeat(10)
  const est = estimateTokens(text)
  // ~90 words → roughly 90-140 tokens; accept a generous band.
  const pass = est > 60 && est < 220
  return {
    name: "compaction/token-estimator",
    pass,
    score: pass ? 1 : 0,
    detail: `estimated ${est} tokens for ${text.length} chars`,
  }
}

export const BUILTIN_EVALS: EvalCase[] = [
  evalCompression,
  evalLogCompression,
  evalSkeletonGate,
  evalSpecRoundTrip,
  evalTokenEstimator,
]

/** Run a set of eval cases and produce a scorecard. */
export async function runEvals(cases: EvalCase[] = BUILTIN_EVALS): Promise<EvalReport> {
  const results: EvalResult[] = []
  for (const c of cases) {
    try {
      results.push(await c())
    } catch (err) {
      results.push({ name: "unknown", pass: false, score: 0, detail: `threw: ${(err as Error).message}` })
    }
  }
  const passed = results.filter((r) => r.pass).length
  const averageScore = results.length ? results.reduce((s, r) => s + r.score, 0) / results.length : 0
  return { results, passed, total: results.length, averageScore }
}

/** Run builtin capability evals plus any auto-grown project regressions. */
export async function runProjectEvals(projectRoot: string): Promise<EvalReport> {
  const { regressionCases } = await import("./regressions.js")
  return runEvals([...BUILTIN_EVALS, ...regressionCases(projectRoot)])
}
