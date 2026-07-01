/**
 * Task benchmark harness.
 *
 * Runs the agent against a suite of real, self-contained coding tasks in a
 * throwaway temp directory, then verifies the result with a deterministic
 * check (run a command, assert output). Produces a success-rate number so we
 * can track whether changes make the agent better or worse.
 *
 * Unlike the capability evals (which test pure functions), this exercises the
 * full agent loop end-to-end — so it requires a configured model. Tasks are
 * small enough to run on a fast model.
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import type { Runtime } from "../runtime.js"
import type { LoopHandlers } from "../session/loop.js"

export interface BenchTask {
  name: string
  /** The instruction given to the agent. */
  prompt: string
  /** Files to seed the temp project with before the agent runs. */
  setup?: Record<string, string>
  /** Verify success: return true if the task was completed correctly. */
  verify: (dir: string) => boolean
}

export interface BenchResult {
  name: string
  pass: boolean
  steps: number
  durationMs: number
  detail: string
}

export interface BenchReport {
  results: BenchResult[]
  passed: number
  total: number
  successRate: number
  totalDurationMs: number
}

/** Run a node script in a dir and return stdout (empty on failure). */
function runNode(dir: string, file: string): { ok: boolean; out: string } {
  const res = spawnSync("node", [file], { cwd: dir, encoding: "utf-8", timeout: 30_000 })
  return { ok: res.status === 0, out: (res.stdout ?? "") + (res.stderr ?? "") }
}

/** The built-in benchmark suite — small, deterministic, language-agnostic. */
export const BENCH_TASKS: BenchTask[] = [
  {
    name: "create-function",
    prompt:
      "Create a file `math.js` that exports a function `add(a, b)` returning their sum, " +
      "using CommonJS (module.exports). Then create `run.js` that requires it and prints add(2,3).",
    verify: (dir) => {
      if (!existsSync(join(dir, "math.js"))) return false
      const r = runNode(dir, "run.js")
      return r.ok && r.out.trim().includes("5")
    },
  },
  {
    name: "fix-bug",
    prompt:
      "There is a bug in `buggy.js`: the function should return the MAXIMUM of the array but returns the minimum. " +
      "Fix it so `node check.js` prints 9.",
    setup: {
      "buggy.js": "module.exports = function max(arr){ return arr.reduce((a,b)=>a<b?a:b); }",
      "check.js": "const max=require('./buggy');console.log(max([3,9,1,5]));",
    },
    verify: (dir) => {
      const r = runNode(dir, "check.js")
      return r.ok && r.out.trim().includes("9")
    },
  },
  {
    name: "add-test",
    prompt:
      "Create `sum.js` exporting `sum(nums)` that adds an array of numbers, and `sum.test.js` " +
      "using node:assert that checks sum([1,2,3])===6. Make `node sum.test.js` exit 0 and print 'ok'.",
    verify: (dir) => {
      if (!existsSync(join(dir, "sum.js"))) return false
      const r = runNode(dir, "sum.test.js")
      return r.ok && r.out.toLowerCase().includes("ok")
    },
  },
]

const silentHandlers = (): LoopHandlers => ({
  onText: () => {},
  onToolStart: () => {},
  onToolEnd: () => {},
  report: () => {},
  requestApproval: async () => true,
})

/** Run the benchmark suite against the runtime's agent. */
export async function runBenchmark(rt: Runtime, tasks: BenchTask[] = BENCH_TASKS): Promise<BenchReport> {
  const results: BenchResult[] = []
  const start = Date.now()

  for (const task of tasks) {
    const dir = mkdtempSync(join(tmpdir(), "spectra-bench-"))
    const t0 = Date.now()
    let steps = 0
    let pass = false
    let detail = ""
    try {
      for (const [path, content] of Object.entries(task.setup ?? {})) {
        writeFileSync(join(dir, path), content, "utf-8")
      }
      // Full-access build agent in the temp dir.
      const agent = { ...rt.agents.current_(), permission: { "*": "allow" as const }, allowedTools: null }
      const session = rt.sessions.create(agent.id, agent.model ?? rt.config.config.model, undefined, false)
      // Run the loop with the temp dir as the working root.
      const origRoot = rt.config.projectRoot
      ;(rt.config as { projectRoot: string }).projectRoot = dir
      try {
        const result = await rt.loop.run({
          sessionId: session.id,
          agent,
          userMessage: task.prompt,
          taskKind: "build",
          handlers: silentHandlers(),
          maxSteps: 20,
        })
        steps = result.steps
      } finally {
        ;(rt.config as { projectRoot: string }).projectRoot = origRoot
      }
      pass = task.verify(dir)
      detail = pass ? "verified" : "verification failed"
    } catch (err) {
      detail = `error: ${(err as Error).message}`
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    results.push({ name: task.name, pass, steps, durationMs: Date.now() - t0, detail })
  }

  const passed = results.filter((r) => r.pass).length
  return {
    results,
    passed,
    total: results.length,
    successRate: results.length ? passed / results.length : 0,
    totalDurationMs: Date.now() - start,
  }
}
