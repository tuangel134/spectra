/**
 * Log compressor.
 *
 * Logs are mostly noise: repeated heartbeat lines, progress spinners, and deep
 * stack traces. This compressor:
 *   - collapses runs of identical lines into `line  (×N)`,
 *   - shortens long stack traces to the first few frames plus a count, and
 *   - never drops lines that carry an error/fatal signal.
 *
 * It is lossy by design (counts replace repetition), which is why the original
 * is preserved for retrieval.
 */

const STACK_FRAME = /^\s+(at\s|File\s"|\w+\s+in\s|#\d+\s)/
const ERROR_SIGNAL = /\b(ERROR|FATAL|EXCEPTION|PANIC|Traceback|Caused by)\b/i
const MAX_FRAMES = 4

/**
 * Reduce a line to a stable "template" by masking volatile tokens (timestamps,
 * numbers, hex addresses, UUIDs). Two heartbeat lines that differ only by their
 * timestamp collapse to the same template, so repetition is detected even when
 * the raw lines are not byte-identical.
 */
function template(line: string): string {
  return line
    .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?/g, "§TS")
    .replace(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, "§TS")
    .replace(/0x[0-9a-fA-F]+/g, "§HEX")
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "§UUID")
    .replace(/\b\d+\b/g, "§N")
}

export interface LogCompressResult {
  text: string
  changed: boolean
}

/**
 * Collapse consecutive lines that share a template into one counted line.
 * Error/fatal lines are never collapsed so their detail is preserved.
 */
function collapseRepeats(lines: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (ERROR_SIGNAL.test(line)) {
      out.push(line)
      i++
      continue
    }
    const tpl = template(line)
    let count = 1
    while (
      i + count < lines.length &&
      !ERROR_SIGNAL.test(lines[i + count]!) &&
      template(lines[i + count]!) === tpl
    ) {
      count++
    }
    out.push(count > 1 ? `${line}  (×${count})` : line)
    i += count
  }
  return out
}

/** Shorten long runs of stack-trace frames, keeping error context intact. */
function collapseStackFrames(lines: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (STACK_FRAME.test(lines[i]!)) {
      let run = 0
      while (i + run < lines.length && STACK_FRAME.test(lines[i + run]!)) run++
      if (run > MAX_FRAMES) {
        for (let k = 0; k < MAX_FRAMES - 1; k++) out.push(lines[i + k]!)
        out.push(`    … ${run - (MAX_FRAMES - 1)} more stack frames …`)
      } else {
        for (let k = 0; k < run; k++) out.push(lines[i + k]!)
      }
      i += run
    } else {
      out.push(lines[i]!)
      i++
    }
  }
  return out
}

/** Compress a log payload. */
export function compressLogs(text: string): LogCompressResult {
  const lines = text.split("\n")
  const collapsed = collapseStackFrames(collapseRepeats(lines))

  // Safety net: ensure every error/fatal line from the original survives.
  const errorLines = lines.filter((l) => ERROR_SIGNAL.test(l))
  for (const errLine of errorLines) {
    if (!collapsed.some((l) => l.startsWith(errLine))) collapsed.push(errLine)
  }

  const result = collapsed.join("\n")
  return { text: result, changed: result.length < text.length }
}
