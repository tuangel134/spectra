import { test } from "node:test"
import assert from "node:assert/strict"

import { runEvals, BUILTIN_EVALS } from "../src/eval/index.ts"

test("the builtin eval suite runs and reports a scorecard", async () => {
  const report = await runEvals()
  assert.equal(report.total, BUILTIN_EVALS.length)
  assert.ok(report.passed >= 0 && report.passed <= report.total)
  assert.ok(report.averageScore >= 0 && report.averageScore <= 1)
})

test("all builtin capability evals pass", async () => {
  const report = await runEvals()
  const failed = report.results.filter((r) => !r.pass).map((r) => r.name)
  assert.deepEqual(failed, [], `failing evals: ${failed.join(", ")}`)
})
