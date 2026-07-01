/**
 * Model routing.
 *
 * Decides which model handles each step and provides automatic failover so a
 * long task never stops just because one model ran out of tokens/credits.
 *
 * Modes:
 *   - "manual": always the session's main model (classic behavior).
 *   - "semi":   the user assigns a model per task kind (plan/build/fix/…).
 *   - "auto":   the router picks the cheapest capable model per step
 *               (light steps → small model, heavy steps → main model).
 *   - "tiered": difficulty-aware routing (à la Kiro) — each step is classified
 *               easy / medium / hard and sent to the cheap / mid / expensive
 *               model configured for that tier. Best cost/quality tradeoff.
 *
 * Autochange: an ordered list of up to 3 fallback models. When the active model
 * fails with a token/quota/credit error, Spectra transparently switches to the
 * next fallback and retries — and remembers the exhausted model on a cooldown
 * so subsequent steps don't keep hitting it. Ideal for the Long-Running
 * autopilot.
 */

import { ProviderError } from "../provider/types.js"

export type TaskKind = "default" | "build" | "plan" | "fix" | "research" | "verify" | "subagent" | "summary"

export type RoutingMode = "manual" | "semi" | "auto" | "tiered"

export type TaskDifficulty = "easy" | "medium" | "hard"

export interface RoutingConfig {
  mode: RoutingMode
  /** semi mode: model id per task kind. */
  assignments: Partial<Record<TaskKind, string>>
  autochange: {
    enabled: boolean
    /** Up to 3 fallback model ids, tried in order on token/quota errors. */
    fallbacks: string[]
  }
  /** tiered mode: model id per difficulty tier. */
  tiers: { easy?: string; medium?: string; hard?: string }
}

export const DEFAULT_ROUTING: RoutingConfig = {
  mode: "manual",
  assignments: {},
  autochange: { enabled: false, fallbacks: [] },
  tiers: {},
}

/** Task kinds that are "light" and can run on the small/cheaper model in auto mode. */
const LIGHT_KINDS = new Set<TaskKind>(["summary", "verify", "research"])

/** Keywords that signal a genuinely hard task (architecture/algorithms/etc.). */
const HARD_SIGNALS =
  /\b(architect\w*|design\b|refactor\w*|migrat\w*|concurren\w*|parallel\w*|distribut\w*|optimi[sz]\w*|performance|securit\w*|cryptograph\w*|algorithm\w*|debug\w*|race condition|deadlock|memory leak|scalab\w*|end-to-end|integrat\w*|orchestrat\w*|state machine|compiler|parser|protocol|threading|async\w*)\b/gi
/** Keywords that signal a trivial task (rename/typo/format/etc.). */
const EASY_SIGNALS =
  /\b(rename|typo|comment|docstring|format\w*|lint\w*|spacing|indent\w*|readme|changelog|bump|spelling|whitespace|rephrase|wording|small fix|one-?liner)\b/i

const HARD_KINDS = new Set<TaskKind>(["plan"])
const EASY_KINDS = new Set<TaskKind>(["summary", "verify"])

/**
 * Estimate a task's difficulty from its prompt text and kind — a fast,
 * deterministic heuristic (no extra model call). Used by "tiered" routing to
 * send cheap work to cheap models and reserve expensive models for hard work.
 *
 * Baseline is "medium"; trivial signals pull it down to "easy", while
 * architecture/algorithm signals, long multi-requirement prompts, and the
 * planning kind push it up to "hard".
 */
export function classifyDifficulty(text: string, kind: TaskKind = "default"): TaskDifficulty {
  const t = text ?? ""
  let score = 1 // baseline: a normal task is medium

  const len = t.length
  if (len > 1200) score += 2
  else if (len > 400) score += 1

  // Each distinct hard keyword adds weight (capped), so genuinely complex
  // prompts climb quickly into the hard tier.
  const hardMatches = (t.match(HARD_SIGNALS) ?? []).length
  score += Math.min(hardMatches, 3)

  if (EASY_SIGNALS.test(t)) score -= 2

  // Enumerations / multi-requirement prompts are usually harder.
  const bullets = (t.match(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s/g) ?? []).length
  if (bullets >= 5) score += 2
  else if (bullets >= 2) score += 1

  if (/\b(multiple files|across|entire|whole|several|many|full[- ]?stack)\b/i.test(t)) score += 1

  if (HARD_KINDS.has(kind)) score += 1
  if (EASY_KINDS.has(kind)) score -= 2

  if (score <= 0) return "easy"
  if (score >= 3) return "hard"
  return "medium"
}

/**
 * Detect whether a provider error means the model is out of
 * tokens/credits/quota (as opposed to a transient or logic error).
 */
export function isExhaustionError(err: unknown): boolean {
  if (!(err instanceof ProviderError)) {
    const msg = String((err as Error)?.message ?? "").toLowerCase()
    return /insufficient|quota|credit|balance|out of tokens|billing|rate.?limit|too many requests|429|exceeded/.test(msg)
  }
  if (err.status === 402 || err.status === 429) return true
  const hay = `${err.message} ${err.body ?? ""}`.toLowerCase()
  return /insufficient_quota|insufficient|quota|credit|balance|billing|rate.?limit|too many requests|exceeded|out of tokens/.test(hay)
}

/** Default cooldown when a model is exhausted without a retry-after hint. */
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000

export class ModelRouter {
  /** model id -> unix ms after which it may be tried again. */
  private readonly cooldownUntil = new Map<string, number>()

  constructor(
    private readonly getConfig: () => RoutingConfig,
    private readonly getMainModel: () => string,
    private readonly getSmallModel: () => string,
  ) {}

  /**
   * Remember that a model is exhausted/rate-limited. Until the cooldown passes
   * it is pushed to the back of the chain so steps don't waste calls on it.
   * Honors a `retry-after` (seconds) when the provider supplied one.
   */
  markExhausted(model: string, retryAfterSeconds?: number): void {
    const secs = retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : DEFAULT_COOLDOWN_MS
    this.cooldownUntil.set(model, Date.now() + Math.min(secs, MAX_COOLDOWN_MS))
  }

  /** Whether a model is currently cooling down after a recent exhaustion. */
  onCooldown(model: string): boolean {
    const until = this.cooldownUntil.get(model)
    if (until === undefined) return false
    if (Date.now() >= until) {
      this.cooldownUntil.delete(model)
      return false
    }
    return true
  }

  /** The single model to use for a task kind (before failover). */
  pick(kind: TaskKind = "default", hint?: { text?: string }): string {
    const cfg = this.getConfig()
    const main = this.getMainModel()
    if (cfg.mode === "manual") return main
    if (cfg.mode === "semi") {
      return cfg.assignments[kind] ?? cfg.assignments["default"] ?? main
    }
    if (cfg.mode === "tiered") {
      const difficulty = classifyDifficulty(hint?.text ?? "", kind)
      const tiers = cfg.tiers ?? {}
      const small = this.getSmallModel()
      const chosen =
        difficulty === "easy"
          ? tiers.easy ?? small
          : difficulty === "hard"
            ? tiers.hard ?? main
            : tiers.medium ?? main
      return chosen || main
    }
    // auto: cheapest capable model for the step.
    const small = this.getSmallModel()
    if (LIGHT_KINDS.has(kind) && small) return small
    return main
  }

  /**
   * The ordered list of models to try for a task kind: the primary pick
   * followed by the configured fallbacks (when autochange is on), de-duplicated.
   * Models on cooldown are moved to the back (sticky failover).
   */
  chain(kind: TaskKind = "default", hint?: { text?: string }): string[] {
    const cfg = this.getConfig()
    const primary = this.pick(kind, hint)
    const out = [primary]
    if (cfg.autochange.enabled) {
      for (const f of cfg.autochange.fallbacks.slice(0, 3)) {
        if (f && !out.includes(f)) out.push(f)
      }
    }
    // Sticky failover: try not-cooling models first, exhausted ones last.
    const live = out.filter((m) => !this.onCooldown(m))
    const cooling = out.filter((m) => this.onCooldown(m))
    const reordered = [...live, ...cooling]
    return reordered.length > 0 ? reordered : out
  }

  /** Classify a task's difficulty (exposed for UI / autorun reporting). */
  difficultyOf(text: string, kind: TaskKind = "default"): TaskDifficulty {
    return classifyDifficulty(text, kind)
  }

  /** Whether autochange failover is active. */
  get failoverEnabled(): boolean {
    return this.getConfig().autochange.enabled && this.getConfig().autochange.fallbacks.length > 0
  }
}
