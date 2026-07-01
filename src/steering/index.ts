/**
 * Steering loader.
 *
 * Composes the always-on project context that should be injected into EVERY
 * agent turn's system prompt: the repo's convention files (AGENTS.md, CLAUDE.md,
 * .cursorrules) and any `.spectra/steering/*.md` marked `inclusion: always`
 * (the default). `manual` / `fileMatch` steering is contextual and skipped here.
 *
 * Without this, "steering" would only be visible in the UI and never actually
 * influence the model — this is what makes it real.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const MAX_CHARS = 12_000
const CACHE_TTL_MS = 5_000

interface Cached {
  text: string
  at: number
}
const cache = new Map<string, Cached>()

interface Frontmatter {
  inclusion?: string
}

/** Split optional YAML-ish frontmatter (--- … ---) from the body. */
function splitFrontmatter(text: string): { front: Frontmatter; body: string } {
  if (!text.startsWith("---")) return { front: {}, body: text }
  const end = text.indexOf("\n---", 3)
  if (end === -1) return { front: {}, body: text }
  const header = text.slice(3, end)
  const body = text.slice(end + 4).replace(/^\r?\n/, "")
  const front: Frontmatter = {}
  for (const line of header.split("\n")) {
    const m = /^\s*([A-Za-z_]+)\s*:\s*(.+?)\s*$/.exec(line)
    if (m && m[1]!.toLowerCase() === "inclusion") front.inclusion = m[2]!.replace(/["']/g, "").trim()
  }
  return { front, body }
}

/** Read the always-on steering text for a project (cached briefly). */
export function loadSteering(projectRoot: string): string {
  const hit = cache.get(projectRoot)
  const now = Date.now()
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.text

  const parts: string[] = []

  // Repo convention files (widely-used cross-tool standards).
  for (const file of ["AGENTS.md", "CLAUDE.md", ".cursorrules"]) {
    const p = join(projectRoot, file)
    if (!existsSync(p)) continue
    try {
      const content = readFileSync(p, "utf-8").trim()
      if (content) parts.push(`## ${file}\n${content}`)
    } catch {
      /* unreadable — skip */
    }
  }

  // Project steering files marked (or defaulting to) inclusion: always.
  const dir = join(projectRoot, ".spectra", "steering")
  if (existsSync(dir)) {
    let names: string[] = []
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".md")).sort()
    } catch {
      names = []
    }
    for (const name of names) {
      try {
        const raw = readFileSync(join(dir, name), "utf-8")
        const { front, body } = splitFrontmatter(raw)
        const inclusion = (front.inclusion ?? "always").toLowerCase()
        if (inclusion !== "always") continue
        const trimmed = body.trim()
        if (trimmed) parts.push(`## ${name}\n${trimmed}`)
      } catch {
        /* skip */
      }
    }
  }

  let text = parts.join("\n\n")
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "\n…(steering truncated)"
  cache.set(projectRoot, { text, at: now })
  return text
}
