/**
 * SmartCrusher — JSON compressor.
 *
 * JSON is where agents waste the most tokens: search results, API responses and
 * DB rows are arrays of objects that repeat the same keys hundreds of times.
 * This compressor:
 *   - strips pretty-print whitespace (compact re-serialization),
 *   - collapses arrays of homogeneous objects into a columnar table so each key
 *     name appears once instead of once per row,
 *   - truncates very large arrays, keeping the head and tail (the original is
 *     recoverable via CCR), and
 *   - renders scalar wrapper fields around a primary array.
 *
 * The output is a dense, human/LLM-readable summary — not necessarily valid
 * JSON — clearly intended for consumption, with the original retrievable.
 */

const MIN_ARRAY_ROWS = 5
const MAX_ROWS_HEAD = 30
const MAX_ROWS_TAIL = 5

/** Render a single cell value compactly. */
function cell(value: unknown): string {
  let s: string
  if (value === null) s = "null"
  else if (typeof value === "string") s = JSON.stringify(value)
  else if (typeof value === "object") {
    const json = JSON.stringify(value)
    s = json.length > 120 ? json.slice(0, 117) + "…" : json
  } else s = String(value)
  // Escape the column separator so values that contain '|' can't be mistaken
  // for a column break when the model reads the table.
  return s.replace(/\|/g, "\\|")
}

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length >= MIN_ARRAY_ROWS &&
    value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))
  )
}

/** Collapse an array of objects into a columnar table string. */
function renderTable(
  rows: Record<string, unknown>[],
  headRows = MAX_ROWS_HEAD,
  tailRows = MAX_ROWS_TAIL,
): string {
  // Column union, ordered by first appearance.
  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }

  const renderRow = (row: Record<string, unknown>, index: number): string => {
    const values = columns.map((col) => (col in row ? cell(row[col]) : "-"))
    return `[${index}] ${values.join(" | ")}`
  }

  const out: string[] = [`«table» ${rows.length} rows · columns: ${columns.join(", ")}`]

  if (rows.length <= headRows + tailRows) {
    rows.forEach((row, i) => out.push(renderRow(row, i)))
  } else {
    for (let i = 0; i < headRows; i++) out.push(renderRow(rows[i]!, i))
    out.push(`… ${rows.length - headRows - tailRows} more rows omitted …`)
    for (let i = rows.length - tailRows; i < rows.length; i++) out.push(renderRow(rows[i]!, i))
  }

  return out.join("\n")
}

/** Find the largest object-array among an object's top-level values. */
function findPrimaryArray(
  obj: Record<string, unknown>,
): { key: string; rows: Record<string, unknown>[] } | undefined {
  let best: { key: string; rows: Record<string, unknown>[] } | undefined
  for (const [key, value] of Object.entries(obj)) {
    if (isObjectArray(value) && (!best || value.length > best.rows.length)) {
      best = { key, rows: value }
    }
  }
  return best
}

export interface JsonCompressResult {
  text: string
  changed: boolean
}

export interface JsonCompressOptions {
  /** Rows to keep from the head before omitting the middle. */
  headRows?: number
  /** Rows to keep from the tail. */
  tailRows?: number
}

/** Compress a JSON payload. Returns the original text unchanged if no win. */
export function compressJson(text: string, opts: JsonCompressOptions = {}): JsonCompressResult {
  const headRows = opts.headRows ?? MAX_ROWS_HEAD
  const tailRows = opts.tailRows ?? MAX_ROWS_TAIL
  let value: unknown
  try {
    value = JSON.parse(text.trim())
  } catch {
    return { text, changed: false }
  }

  // Case 1: top-level array of objects → table.
  if (isObjectArray(value)) {
    return { text: renderTable(value, headRows, tailRows), changed: true }
  }

  // Case 2: wrapper object containing a primary object-array.
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const primary = findPrimaryArray(obj)
    if (primary) {
      const scalars: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(obj)) {
        if (k !== primary.key) scalars[k] = v
      }
      const header = Object.keys(scalars).length
        ? `«meta» ${JSON.stringify(scalars)}\n`
        : ""
      return { text: `${header}«field» ${primary.key}:\n${renderTable(primary.rows, headRows, tailRows)}`, changed: true }
    }
  }

  // Case 3: any other JSON — just strip whitespace via compact re-serialization.
  const compact = JSON.stringify(value)
  // Only claim a win if it actually shrank meaningfully (was pretty-printed).
  if (compact.length < text.length * 0.9) {
    return { text: compact, changed: true }
  }
  return { text, changed: false }
}
