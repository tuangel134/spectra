/**
 * Token cost estimation.
 *
 * Approximate USD pricing per 1M tokens for well-known models, used to show a
 * running cost estimate. Prices are heuristics for display only (providers are
 * the source of truth for billing). Free/local models cost $0.
 */

interface Price {
  inPerM: number
  outPerM: number
}

/** Matched by substring against the model id (provider/model). */
const PRICES: { match: RegExp; price: Price }[] = [
  { match: /(^|\/)free(buff)?\//i, price: { inPerM: 0, outPerM: 0 } },
  { match: /-free\b/i, price: { inPerM: 0, outPerM: 0 } },
  { match: /ollama\//i, price: { inPerM: 0, outPerM: 0 } },
  { match: /opus/i, price: { inPerM: 15, outPerM: 75 } },
  { match: /sonnet/i, price: { inPerM: 3, outPerM: 15 } },
  { match: /haiku/i, price: { inPerM: 0.8, outPerM: 4 } },
  { match: /gpt-5|gpt5/i, price: { inPerM: 5, outPerM: 15 } },
  { match: /gpt-4o|gpt4o/i, price: { inPerM: 2.5, outPerM: 10 } },
  { match: /o3|o1/i, price: { inPerM: 10, outPerM: 40 } },
  { match: /gemini.*flash/i, price: { inPerM: 0.3, outPerM: 1.2 } },
  { match: /gemini/i, price: { inPerM: 1.25, outPerM: 5 } },
  { match: /deepseek/i, price: { inPerM: 0.27, outPerM: 1.1 } },
  { match: /qwen|kimi|glm/i, price: { inPerM: 0.5, outPerM: 1.5 } },
]

/** Price for a model id, defaulting to a mid-range estimate when unknown. */
export function priceFor(modelId: string): Price {
  for (const { match, price } of PRICES) {
    if (match.test(modelId)) return price
  }
  return { inPerM: 1, outPerM: 3 }
}

/** Estimated USD cost for a token usage on a given model. */
export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(modelId)
  return (inputTokens / 1_000_000) * p.inPerM + (outputTokens / 1_000_000) * p.outPerM
}

export interface CostSummary {
  inputTokens: number
  outputTokens: number
  usd: number
}

/** Sum cost across sessions (each may use a different model). */
export function summarizeCost(
  sessions: { model: string; usage: { inputTokens: number; outputTokens: number } }[],
): CostSummary {
  let inputTokens = 0
  let outputTokens = 0
  let usd = 0
  for (const s of sessions) {
    inputTokens += s.usage.inputTokens
    outputTokens += s.usage.outputTokens
    usd += estimateCost(s.model, s.usage.inputTokens, s.usage.outputTokens)
  }
  return { inputTokens, outputTokens, usd }
}
