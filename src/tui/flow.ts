/**
 * Interactive multi-step prompt flows for the TUI.
 *
 * A Flow drives a sequence of questions (select / text / secret) inside the
 * full-screen interface. Steps can branch based on previous answers, so flows
 * like /connect can adapt (custom provider needs a base URL, Ollama needs no
 * key, etc.). Pure data + a resolver; the app renders and feeds answers.
 */

export interface FlowOption {
  label: string
  value: string
}

export interface FlowStep {
  /** Question shown to the user. */
  question: string
  /** If present, render a numbered selection list. */
  options?: FlowOption[]
  /** Mask typed input (for secrets like API keys). */
  mask?: boolean
  /** Allow a free-text answer even when options are present (e.g. a model id). */
  allowFreeText?: boolean
  /** Optional validation; return an error string or null if valid. */
  validate?: (value: string) => string | null
}

export interface Flow {
  /** Title shown when the flow starts. */
  title: string
  /** Return the next step given answers so far, or null when complete. */
  next(answers: string[]): FlowStep | null
  /** Called with all answers once the flow completes. */
  complete(answers: string[]): Promise<void> | void
}

/**
 * Resolve a raw user input against a step, returning the canonical value or an
 * error. For selection steps, accepts a 1-based index, the option value, or a
 * case-insensitive label match.
 */
export function resolveAnswer(step: FlowStep, raw: string): { value?: string; error?: string } {
  const input = raw.trim()

  if (step.options) {
    const n = Number(input)
    if (!Number.isNaN(n) && n >= 1 && n <= step.options.length) {
      return { value: step.options[n - 1]!.value }
    }
    const match = step.options.find(
      (o) => o.value === input || o.label.toLowerCase() === input.toLowerCase(),
    )
    if (match) return { value: match.value }
    // Allow a typed free-text value (e.g. a model id) when the step permits it.
    if (step.allowFreeText && input) {
      if (step.validate) {
        const err = step.validate(input)
        if (err) return { error: err }
      }
      return { value: input }
    }
    return { error: "Please choose a valid option (number or name)." }
  }

  if (step.validate) {
    const err = step.validate(input)
    if (err) return { error: err }
  }

  return { value: input }
}
