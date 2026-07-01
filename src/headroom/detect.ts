/**
 * Content-type detection (Headroom's ContentRouter).
 *
 * Cheap, allocation-light heuristics that decide which compressor a payload
 * should go through. We deliberately keep this conservative: when in doubt we
 * fall back to "text", which uses the gentlest (lossless) compressor.
 */

import type { ContentType } from "./types.js"

/** A line looks like a log entry if it carries a level or a timestamp. */
const LOG_LINE = /(\bERROR\b|\bWARN(?:ING)?\b|\bINFO\b|\bDEBUG\b|\bTRACE\b|\bFATAL\b)|^\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}|^\s*\[\d{2}:\d{2}:\d{2}/

/** Common code signals across languages. */
const CODE_SIGNALS = [
  /\bfunction\b|\bconst\b|\blet\b|\bvar\b|=>/,
  /\bclass\b|\binterface\b|\bimport\b|\bexport\b/,
  /\bdef\b|\bself\b|\bimport\b/,
  /\bpublic\b|\bprivate\b|\bstatic\b|\bvoid\b/,
  /[{};]\s*$/m,
]

/** Try to parse as JSON; returns the value or `undefined`. */
export function tryParseJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const first = trimmed[0]
  if (first !== "{" && first !== "[") return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

/**
 * Classify a payload. Order matters: JSON is the most specific and highest
 * value, then logs, then code, with prose as the catch-all.
 */
export function detectContentType(text: string): ContentType {
  if (tryParseJson(text) !== undefined) return "json"

  const lines = text.split("\n")
  const sample = lines.slice(0, 200)

  // Logs: a meaningful fraction of lines look like log entries.
  let logLike = 0
  for (const line of sample) {
    if (LOG_LINE.test(line)) logLike++
  }
  if (sample.length >= 4 && logLike / sample.length >= 0.3) return "logs"

  // Code: several distinct code signals present.
  let codeHits = 0
  for (const re of CODE_SIGNALS) {
    if (re.test(text)) codeHits++
  }
  if (codeHits >= 2) return "code"

  return "text"
}
