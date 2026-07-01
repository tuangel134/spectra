/**
 * Skill loader.
 *
 * Discovers skills from Spectra, Claude, and OpenCode locations so existing
 * skill libraries work unchanged:
 *   - <project>/.spectra/skills/<name>/SKILL.md
 *   - <project>/.claude/skills/<name>/SKILL.md
 *   - <project>/.opencode/skill/<name>/SKILL.md
 *   - ~/.spectra/skills/<name>/SKILL.md   (global)
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

import type { Skill } from "./types.js"

interface Frontmatter {
  data: Record<string, string>
  body: string
}

/** Parse a minimal `---` YAML frontmatter block (string scalars only). */
export function parseFrontmatter(text: string): Frontmatter {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { data: {}, body: text }
  const data: Record<string, string> = {}
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (kv) data[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^["']|["']$/g, "")
  }
  return { data, body: (match[2] ?? "").trim() }
}

interface SkillRoot {
  dir: string
  source: string
}

function skillRoots(projectRoot: string): SkillRoot[] {
  return [
    { dir: join(projectRoot, ".spectra", "skills"), source: "spectra" },
    { dir: join(projectRoot, ".claude", "skills"), source: "claude" },
    { dir: join(projectRoot, ".opencode", "skill"), source: "opencode" },
    { dir: join(homedir(), ".spectra", "skills"), source: "global" },
  ]
}

/** Load every discoverable skill (most specific source wins on name clash). */
export function loadSkills(projectRoot: string): Skill[] {
  const byName = new Map<string, Skill>()

  for (const root of skillRoots(projectRoot)) {
    if (!existsSync(root.dir)) continue
    let entries: string[]
    try {
      entries = readdirSync(root.dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const folder = join(root.dir, entry)
      let isDir = false
      try {
        isDir = statSync(folder).isDirectory()
      } catch {
        continue
      }
      if (!isDir) continue
      const skillFile = join(folder, "SKILL.md")
      if (!existsSync(skillFile)) continue
      try {
        const raw = readFileSync(skillFile, "utf-8")
        const { data, body } = parseFrontmatter(raw)
        const name = (data["name"] || entry).trim()
        if (byName.has(name)) continue // earlier (more specific) root wins
        byName.set(name, {
          name,
          description: data["description"] || "(no description)",
          instructions: body,
          path: skillFile,
          source: root.source,
          allowedTools: data["allowed-tools"]
            ? data["allowed-tools"].split(",").map((s) => s.trim()).filter(Boolean)
            : undefined,
        })
      } catch {
        /* ignore unreadable skill */
      }
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
}
