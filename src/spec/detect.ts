/**
 * Spec-intent detection.
 *
 * A fast, deterministic heuristic (no extra model call) that decides whether a
 * free-form user message is asking to BUILD something substantial — a feature
 * or a whole project — which benefits from the spec-driven flow (clarifying
 * questions → requirements → design → tasks), versus a small edit, a question,
 * or a chat that should just be answered directly.
 *
 * This is what lets Spectra propose spec mode automatically instead of making
 * the user remember to type `/spec`.
 */

/** How Spectra reacts when it detects a spec-worthy request. */
export type SpecDetectMode = "ask" | "auto" | "off"

export interface SpecIntent {
  /** True when the message looks like a build/feature request worth a spec. */
  spec: boolean
  /** Heuristic score (higher = more clearly spec-worthy). */
  score: number
  /** Human-readable signals that drove the decision. */
  reason: string
}

const BUILD_VERBS =
  /\b(build|create|implement|develop|make|design|scaffold|generate|construct|write me|code( me)?|program|set ?up|put together)\b/i
const PROJECT_NOUNS =
  /\b(app|application|api|service|micro-?service|system|web ?site|platform|dashboard|back-?end|front-?end|full-?stack|feature|endpoint|cli|tool(kit)?|library|package|bot|game|pipeline|integration|crud|server|schema|auth(entication)?|saas|landing page|portal|module|component|website)\b/i
const SCOPE =
  /\b(full-?stack|end-?to-?end|complete|production(-ready)?|with auth|with authentication|with a? ?database|with tests|multiple|several|whole|entire|from scratch|mvp|prototype)\b/i
const NEGATIVE =
  /\b(fix|typo|rename|explain|what is|what's|why|how do|how does|show me|list|read|where is|debug this|format|lint|bump|comment|translate|summari[sz]e|review|tweak|adjust|undo|revert)\b/i
const QUESTIONY = /^\s*(what|why|how|when|where|who|which|can you explain|tell me|is there|are there|does)\b/i

/** Classify whether a message should trigger the spec flow. */
export function detectSpecIntent(text: string): SpecIntent {
  const t = (text ?? "").trim()
  if (!t) return { spec: false, score: 0, reason: "empty" }

  let score = 0
  const reasons: string[] = []

  if (BUILD_VERBS.test(t)) {
    score += 2
    reasons.push("build verb")
  }
  if (PROJECT_NOUNS.test(t)) {
    score += 2
    reasons.push("project noun")
  }
  if (SCOPE.test(t)) {
    score += 2
    reasons.push("project scope")
  }

  // Enumerated / multi-requirement requests are usually spec-worthy.
  const bullets = (t.match(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s/g) ?? []).length
  if (bullets >= 3) {
    score += 2
    reasons.push("multi-requirement list")
  } else if (bullets >= 1) {
    score += 1
  }

  if (t.length > 240) {
    score += 1
    reasons.push("detailed request")
  }

  // Strong signals that this is NOT a build request.
  if (NEGATIVE.test(t)) {
    score -= 3
    reasons.push("edit/question signal")
  }
  if (QUESTIONY.test(t)) {
    score -= 2
    reasons.push("question phrasing")
  }
  if (t.length < 25) score -= 1

  // Need a meaningful combination (e.g. a build verb + a project noun, or
  // explicit scope) to cross the threshold.
  const spec = score >= 4
  return {
    spec,
    score,
    reason: reasons.length ? reasons.join(", ") : "no strong signals",
  }
}
