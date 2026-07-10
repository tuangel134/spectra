/**
 * Agent Skill loader with Spectra, Claude Code, OpenCode and installed Claude
 * plugin compatibility.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import { homedir } from "node:os"
import type { Skill } from "./types.js"
import { claudePluginComponentPaths, discoverClaudePluginRoots } from "../compat/claude.js"

interface Frontmatter {
  data: Record<string, string>
  body: string
}

/** Parse the scalar/list subset used by Agent Skills and Claude Code. */
export function parseFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { data: {}, body: normalized.trim() }

  const data: Record<string, string> = {}
  let activeList: string | null = null
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (kv) {
      const key = kv[1]!.toLowerCase()
      const value = kv[2]!.trim().replace(/^['"]|['"]$/g, "")
      data[key] = value
      activeList = value ? null : key
      continue
    }
    const item = line.match(/^\s*-\s*(.+?)\s*$/)
    if (item && activeList) {
      data[activeList] = [data[activeList], item[1]!.replace(/^['"]|['"]$/g, "")]
        .filter(Boolean)
        .join(",")
    }
  }
  return { data, body: (match[2] ?? "").trim() }
}

interface SkillRoot {
  dir: string
  source: string
  namespace?: string
}

function skillRoots(projectRoot: string, home: string): SkillRoot[] {
  const roots: SkillRoot[] = [
    { dir: join(projectRoot, ".spectra", "skills"), source: "spectra" },
    { dir: join(projectRoot, ".claude", "skills"), source: "claude-project" },
    { dir: join(projectRoot, ".opencode", "skill"), source: "opencode-project" },
    { dir: join(home, ".spectra", "skills"), source: "spectra-user" },
    { dir: join(home, ".claude", "skills"), source: "claude-user" },
  ]
  for (const plugin of discoverClaudePluginRoots(projectRoot, home)) {
    for (const path of claudePluginComponentPaths(plugin, "skills")) {
      roots.push({
        dir: path,
        source: `claude-plugin:${plugin.id}`,
        namespace: plugin.namespace,
      })
    }
  }
  return roots
}

function parseTools(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const unwrapped = value.replace(/^\[/, "").replace(/\]$/, "")
  const tools = unwrapped.split(/[,\n]/).map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean)
  return tools.length ? tools : undefined
}

function addSkill(
  byName: Map<string, Skill>,
  skillFile: string,
  fallbackName: string,
  root: SkillRoot,
): void {
  if (!existsSync(skillFile)) return
  try {
    const { data, body } = parseFrontmatter(readFileSync(skillFile, "utf-8"))
    const localName = (data["name"] || fallbackName).trim()
    const name = root.namespace ? `${root.namespace}:${localName}` : localName
    if (!name || !body || byName.has(name)) return
    byName.set(name, {
      name,
      description: data["description"] || "(no description)",
      instructions: body,
      path: skillFile,
      source: root.source,
      allowedTools: parseTools(data["allowed-tools"]),
    })
  } catch {
    // A broken community skill must not prevent Spectra from starting.
  }
}

/** Load every discoverable skill; earlier roots win on name collisions. */
export function loadSkills(projectRoot: string, home = homedir()): Skill[] {
  const byName = new Map<string, Skill>()
  for (const root of skillRoots(projectRoot, home)) {
    if (!existsSync(root.dir)) continue
    try {
      if (statSync(root.dir).isFile()) {
        if (root.dir.endsWith("SKILL.md")) addSkill(byName, root.dir, basename(root.dir, ".md"), root)
        continue
      }
    } catch {
      continue
    }

    // A manifest path may point directly at a skill directory.
    addSkill(byName, join(root.dir, "SKILL.md"), basename(root.dir), root)
    let entries: string[]
    try {
      entries = readdirSync(root.dir).sort()
    } catch {
      continue
    }

    for (const entry of entries) {
      const folder = join(root.dir, entry)
      try {
        if (!statSync(folder).isDirectory()) continue
      } catch {
        continue
      }
      addSkill(byName, join(folder, "SKILL.md"), entry, root)
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
