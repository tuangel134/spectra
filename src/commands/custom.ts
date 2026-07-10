/** User-defined slash commands, including Claude Code standalone and plugin formats. */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import { homedir } from "node:os"
import { claudePluginComponentPaths, discoverClaudePluginRoots } from "../compat/claude.js"

export interface CustomCommand {
  name: string
  description: string
  template: string
  source?: string
}

function parse(raw: string): { description: string; body: string } {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
  if (normalized.startsWith("---")) {
    const end = normalized.indexOf("\n---", 3)
    if (end !== -1) {
      const header = normalized.slice(3, end)
      const body = normalized.slice(end + 4).replace(/^\n/, "")
      const match = /^\s*description\s*:\s*(.+?)\s*$/im.exec(header)
      return { description: match ? match[1]!.replace(/^['"]|['"]$/g, "").trim() : "", body }
    }
  }
  return { description: "", body: normalized }
}

interface CommandRoot {
  dir: string
  source: string
  namespace?: string
}

function commandRoots(projectRoot: string, home: string): CommandRoot[] {
  const roots: CommandRoot[] = [
    { dir: join(projectRoot, ".spectra", "commands"), source: "spectra-project" },
    { dir: join(projectRoot, ".claude", "commands"), source: "claude-project" },
    { dir: join(home, ".spectra", "commands"), source: "spectra-user" },
    { dir: join(home, ".claude", "commands"), source: "claude-user" },
  ]
  for (const plugin of discoverClaudePluginRoots(projectRoot, home)) {
    for (const path of claudePluginComponentPaths(plugin, "commands")) {
      roots.push({
        dir: path,
        source: `claude-plugin:${plugin.id}`,
        namespace: plugin.namespace,
      })
    }
  }
  return roots
}

function addCommand(byName: Map<string, CustomCommand>, path: string, root: CommandRoot): void {
  const localName = basename(path, ".md")
  const name = root.namespace ? `${root.namespace}:${localName}` : localName
  if (!name || byName.has(name)) return
  try {
    const { description, body } = parse(readFileSync(path, "utf-8"))
    if (!body.trim()) return
    byName.set(name, {
      name,
      description: description || `Custom command: ${name}`,
      template: body.trim(),
      source: root.source,
    })
  } catch {
    // Skip unreadable community commands.
  }
}

/** Discover commands; native/project commands take precedence over plugin commands. */
export function loadCustomCommands(projectRoot: string, home = homedir()): CustomCommand[] {
  const byName = new Map<string, CustomCommand>()
  for (const root of commandRoots(projectRoot, home)) {
    if (!existsSync(root.dir)) continue
    try {
      if (statSync(root.dir).isFile()) {
        if (root.dir.endsWith(".md")) addCommand(byName, root.dir, root)
        continue
      }
    } catch {
      continue
    }

    let files: string[]
    try {
      files = readdirSync(root.dir).filter((name) => name.endsWith(".md")).sort()
    } catch {
      continue
    }
    for (const file of files) addCommand(byName, join(root.dir, file), root)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Substitute Claude/Spectra-compatible argument placeholders. */
export function expandCommandTemplate(template: string, args: string): string {
  const trimmed = args.trim()
  const parts = trimmed.length ? trimmed.split(/\s+/) : []
  return template
    .replace(/\$ARGUMENTS\b/g, trimmed)
    .replace(/\$\{ARGUMENTS\}/g, trimmed)
    .replace(/\$(\d)/g, (_, digit: string) => parts[Number(digit) - 1] ?? "")
}
