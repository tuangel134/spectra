/**
 * Spec clarification questionnaire.
 *
 * Before writing requirements, Spectra asks the model to produce a short set of
 * multiple-choice clarifying questions tailored to the request. The user picks
 * an option or writes their own answer; in "auto" mode the model answers its
 * own questions with sensible production-grade defaults. The answers are then
 * folded into the requirements prompt so the generated spec reflects real
 * decisions instead of guesses.
 *
 * This module is pure (prompt builders + robust parsers + formatters) so it can
 * be unit-tested without a model. The model calls live in workflow/.
 */

export interface ClarifyQuestion {
  question: string
  /** Suggested concrete options; the UI always also offers free text. */
  options: string[]
}

export interface Clarification {
  question: string
  answer: string
}

/** Prompt asking the model to produce multiple-choice clarifying questions. */
export function clarifyPrompt(description: string): string {
  return [
    `A user wants to build the following. Before writing a spec, ask the most`,
    `important clarifying questions that remove ambiguity.`,
    ``,
    `Request: "${description}"`,
    ``,
    `Output ONLY a JSON array (no prose, no markdown fences) of 3 to 6 questions.`,
    `Each item must be:`,
    `  { "question": "<concise question>", "options": ["<concrete choice>", "<choice>"] }`,
    ``,
    `Rules:`,
    `- 2 to 5 options per question, each a concrete, commonly-chosen answer`,
    `  (a specific technology, a yes/no, a scope boundary).`,
    `- Ask about decisions that materially change the design: stack/language,`,
    `  data storage, auth, core scope, interfaces/protocol, testing, deployment.`,
    `- Do NOT include an "other" option — the UI adds a free-text choice itself.`,
    `- Keep each question to one line. Do not number them.`,
  ].join("\n")
}

/** Prompt asking the model to answer its own questions (auto mode). */
export function autoAnswerPrompt(description: string, questions: ClarifyQuestion[]): string {
  return [
    `You are setting up a spec autonomously. Answer each clarifying question`,
    `yourself with the best production-grade default for this request. Choose`,
    `widely-used, modern, sensible options — optimize for a solid, conventional`,
    `implementation.`,
    ``,
    `Request: "${description}"`,
    ``,
    `Questions:`,
    ...questions.map((q, i) => `${i + 1}. ${q.question}  (options: ${q.options.join(" | ")})`),
    ``,
    `Output ONLY a JSON array (no prose):`,
    `[{ "question": "<the question>", "answer": "<your chosen answer>" }]`,
    `with exactly one entry per question.`,
  ].join("\n")
}

/** Extract the first top-level JSON array from a possibly-noisy model reply. */
function extractJsonArray(text: string): unknown {
  let t = (text ?? "").trim()
  // Prefer the contents of a fenced code block if present (```json … ```).
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence && fence[1]) t = fence[1].trim()

  // Fast path: the whole thing is already a JSON array.
  try {
    const v = JSON.parse(t)
    if (Array.isArray(v)) return v
  } catch {
    /* fall through to scanning */
  }

  // Scan for the first balanced [ … ] that parses as a JSON array, ignoring
  // brackets that appear inside strings (so prose like "[see below]" or values
  // containing "[" don't break extraction).
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "[") continue
    let depth = 0
    let inStr = false
    let esc = false
    for (let j = i; j < t.length; j++) {
      const ch = t[j]!
      if (inStr) {
        if (esc) esc = false
        else if (ch === "\\") esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === "[") depth++
      else if (ch === "]") {
        depth--
        if (depth === 0) {
          try {
            const v = JSON.parse(t.slice(i, j + 1))
            if (Array.isArray(v)) return v
          } catch {
            /* not valid here — try the next "[" */
          }
          break
        }
      }
    }
  }
  return null
}

/** Parse clarifying questions from a model reply (robust to extra prose). */
export function parseClarifyQuestions(text: string): ClarifyQuestion[] {
  const arr = extractJsonArray(text)
  if (!Array.isArray(arr)) return []
  const out: ClarifyQuestion[] = []
  const seen = new Set<string>()
  for (const item of arr) {
    if (!item || typeof item !== "object") continue
    const q = (item as { question?: unknown }).question
    const opts = (item as { options?: unknown }).options
    if (typeof q !== "string" || !q.trim()) continue
    const key = q.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const options = Array.isArray(opts)
      ? opts.filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => o.trim()).slice(0, 5)
      : []
    out.push({ question: q.trim(), options })
    if (out.length >= 6) break
  }
  return out
}

/** Parse auto-mode answers; falls back to the first option per question. */
export function parseAutoAnswers(text: string, questions: ClarifyQuestion[]): Clarification[] {
  const arr = extractJsonArray(text)
  const parsed: Clarification[] = []
  if (Array.isArray(arr)) {
    for (const item of arr) {
      if (!item || typeof item !== "object") continue
      const a = (item as { answer?: unknown }).answer
      const q = (item as { question?: unknown }).question
      if (typeof a === "string" && a.trim()) {
        parsed.push({ question: typeof q === "string" ? q.trim() : "", answer: a.trim() })
      }
    }
  }
  // Guarantee one answer per question, defaulting to the first option.
  return questions.map((qq, i) => {
    const hit = parsed[i]
    if (hit && hit.answer) return { question: qq.question, answer: hit.answer }
    return { question: qq.question, answer: qq.options[0] ?? "(use a sensible production default)" }
  })
}

/** Render answered clarifications as a markdown block for the requirements prompt. */
export function formatClarifications(items: Clarification[]): string {
  const real = items.filter((c) => c.answer && c.answer.trim())
  if (real.length === 0) return ""
  return ["## Clarified decisions (honor these)", ...real.map((c) => `- ${c.question} → ${c.answer}`)].join("\n")
}
