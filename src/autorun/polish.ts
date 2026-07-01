/**
 * Polish / completeness review.
 *
 * In long-run mode a project must not just compile and pass tests — it must be
 * genuinely complete and polished (real UI, wired frontend+backend, error
 * handling, tests, no placeholder content). Mechanical checks (build/lint/test
 * + the skeleton scan) can't judge "is this actually finished and good?", so we
 * ask the model to review the delivered project against the goal and report
 * concrete, fixable deficiencies. The orchestrator then fixes them and re-gates.
 *
 * This module holds the pure pieces (prompt + parser) so they're unit-testable.
 */

export interface PolishVerdict {
  /** True when the project looks complete and polished. */
  ok: boolean
  /** Concrete, actionable deficiencies to fix (empty when ok). */
  issues: string[]
  /** Raw model text (truncated) for logging. */
  detail: string
}

/** Build the polish-review prompt for a goal + a project snapshot. */
export function polishPrompt(goal: string, snapshot: string): string {
  return [
    `You are a strict senior reviewer doing FINAL acceptance of a project built in`,
    `long-run autonomous mode. The build and tests already pass — your job is to`,
    `judge whether it is genuinely COMPLETE and POLISHED, end to end.`,
    ``,
    `## Project goal`,
    goal,
    ``,
    `## Delivered project`,
    snapshot,
    ``,
    `## Judge strictly. Reject if ANY of these are true:`,
    `- A feature implied by the goal is missing, partial, or non-functional.`,
    `- Frontend is unstyled, empty, placeholder, or not wired to the backend.`,
    `- Backend lacks input validation, error handling, or real persistence.`,
    `- Placeholder/dummy content, stubbed logic, or "example" data left in.`,
    `- No meaningful tests for the core behavior.`,
    `- Anything that would embarrass a professional shipping this.`,
    ``,
    `Reply with EXACTLY one of:`,
    `  PASS`,
    `  FAIL`,
    `  <numbered list of concrete, fixable deficiencies — file/area + what to do>`,
    ``,
    `Be specific and actionable. If it is genuinely complete and polished, reply PASS only.`,
  ].join("\n")
}

/** Parse the reviewer's verdict; tolerant of prose and formatting. */
export function parsePolishVerdict(text: string): PolishVerdict {
  const t = (text ?? "").trim()
  if (!t) return { ok: true, issues: [], detail: "(empty review)" } // don't block on an empty reply
  // PASS only when the reply is essentially "PASS" with no listed deficiencies.
  const firstLine = t.split("\n")[0]!.trim()
  if (/^pass\b/i.test(firstLine) && !/^fail/im.test(t)) {
    return { ok: true, issues: [], detail: t.slice(0, 200) }
  }
  const issues = t
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length > 0 && !/^fail[:.]?$/i.test(l) && !/^pass$/i.test(l))
  return { ok: false, issues: issues.slice(0, 25), detail: t.slice(0, 1500) }
}
