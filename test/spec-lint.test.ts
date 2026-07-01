import { test } from "node:test"
import assert from "node:assert/strict"

import { lintRequirements, lintReport } from "../src/spec/lint.ts"

const GOOD = `## Acceptance Criteria
- When the user submits the form, the system shall validate all fields.
- While offline, the system shall queue requests.
- If the password is wrong, then the system shall reject the login.
`

const BAD = `## Acceptance Criteria
- The app should be fast and user-friendly.
- TODO: figure out auth
`

test("lintRequirements passes EARS, testable criteria", () => {
  const issues = lintRequirements(GOOD)
  const errors = issues.filter((i) => i.severity === "error")
  assert.equal(errors.length, 0)
})

test("lintRequirements flags vague, non-testable, and placeholder criteria", () => {
  const issues = lintRequirements(BAD)
  assert.ok(issues.some((i) => /vague/i.test(i.message)))
  assert.ok(issues.some((i) => /placeholder/i.test(i.message)))
  assert.ok(issues.some((i) => i.severity === "error"))
})

test("lintRequirements errors when there are no criteria", () => {
  const issues = lintRequirements("## Summary\nJust a summary, no criteria.")
  assert.ok(issues.some((i) => /no acceptance criteria/i.test(i.message)))
})

test("lintReport scores good specs higher than bad ones", () => {
  assert.ok(lintReport(GOOD).score > lintReport(BAD).score)
  assert.equal(lintReport(GOOD).errors, 0)
})
