/**
 * Spec lint.
 *
 * Deterministic quality checks for a requirements document: are criteria
 * written in EARS notation, are they testable, and do they avoid vague language?
 * Used to warn the user (and the autopilot) when a spec is too weak to build
 * reliably.
 */

export interface LintIssue {
  severity: "error" | "warning"
  line: number
  message: string
}

/** EARS keywords that signal a well-formed requirement. */
const EARS = /\bshall\b/i
const EARS_PREFIX = /^\s*(-|\*|\d+\.)?\s*(when|while|if|where|the)\b/i
const VAGUE = /\b(fast|slow|easy|simple|user-friendly|intuitive|robust|efficient|nice|good|etc\.?)\b/i
const PLACEHOLDER = /\b(TODO|TBD|FIXME|\?\?\?)\b/i

/** Lint a requirements markdown document. */
export function lintRequirements(md: string): LintIssue[] {
  const issues: LintIssue[] = []
  const lines = md.split("\n")
  let inCriteria = false
  let criteriaCount = 0
  let shallCount = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const ln = i + 1

    if (/^##\s/.test(line)) {
      inCriteria = /acceptance criteria/i.test(line)
      continue
    }
    if (PLACEHOLDER.test(line)) {
      issues.push({ severity: "error", line: ln, message: `Placeholder in spec: "${line.trim().slice(0, 60)}"` })
    }
    // Only scrutinize bullet/numbered criteria lines.
    const isCriterion = inCriteria && /^\s*(-|\*|\d+\.)\s+\S/.test(line)
    if (!isCriterion) continue
    criteriaCount++
    if (EARS.test(line)) shallCount++
    else if (EARS_PREFIX.test(line) && !EARS.test(line)) {
      issues.push({ severity: "warning", line: ln, message: `Criterion is not testable (missing "shall"): "${line.trim().slice(0, 60)}"` })
    } else {
      issues.push({ severity: "warning", line: ln, message: `Criterion not in EARS form (use When/While/If/Where … shall): "${line.trim().slice(0, 60)}"` })
    }
    if (VAGUE.test(line)) {
      issues.push({ severity: "warning", line: ln, message: `Vague wording in criterion: "${line.trim().slice(0, 60)}"` })
    }
  }

  if (criteriaCount === 0) {
    issues.push({ severity: "error", line: 1, message: "No acceptance criteria found." })
  } else if (shallCount === 0) {
    issues.push({ severity: "error", line: 1, message: "No testable (shall-based) criteria found." })
  }

  return issues
}

export interface LintReport {
  issues: LintIssue[]
  errors: number
  warnings: number
  /** 0..1 quality score. */
  score: number
}

/** Summarize lint issues into a report with a quality score. */
export function lintReport(md: string): LintReport {
  const issues = lintRequirements(md)
  const errors = issues.filter((i) => i.severity === "error").length
  const warnings = issues.filter((i) => i.severity === "warning").length
  // Score: start at 1, subtract more for errors than warnings.
  const score = Math.max(0, 1 - errors * 0.34 - warnings * 0.08)
  return { issues, errors, warnings, score }
}
