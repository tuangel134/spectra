/**
 * User-defined slash commands.
 *
 * Each `.spectra/commands/<name>.md` becomes a `/name` command whose body is a
 * prompt template. `$ARGUMENTS` is replaced with everything after the command,
 * and `$1`..`$9` with positional args. Optional frontmatter `description:` shows
 * in the slash menu. This mirrors Claude Code / OpenCode custom commands.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

export interface CustomCommand {
  name: string
  description: string
  template: string
}

function parse(raw: string): { description: string; body: string } {
  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3)
    if (end !== -1) {
      const header = raw.slice(3, end)
      const body = raw.slice(end + 4).replace(/^\r?\n/, "")
      const m = /^\s*description\s*:\s*(.+?)\s*$/im.exec(header)
      return { description: m ? m[1]!.replace(/["']/g, "").trim() : "", body }
    }
  }
  return { description: "", body: raw }
}

/** Discover user-defined commands from `.spectra/commands/*.md`. */
export function loadCustomCommands(projectRoot: string): CustomCommand[] {
  const dir = join(projectRoot, ".spectra", "commands")
  if (!existsSync(dir)) return []
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((n) => n.endsWith(".md")).sort()
  } catch {
    return []
  }
  const out: CustomCommand[] = []
  for (const file of files) {
    try {
      const { description, body } = parse(readFileSync(join(dir, file), "utf-8"))
      const name = file.replace(/\.md$/, "")
      if (name && body.trim()) {
        out.push({ name, description: description || `Custom command: ${name}`, template: body.trim() })
      }
    } catch {
      /* skip unreadable */
    }
  }
  return out
}

/** Substitute $ARGUMENTS and $1..$9 in a command template. */
export function expandCommandTemplate(template: string, args: string): string {
  const trimmed = args.trim()
  const parts = trimmed.length ? trimmed.split(/\s+/) : []
  return template
    .replace(/\$ARGUMENTS\b/g, trimmed)
    .replace(/\$(\d)/g, (_, d: string) => parts[Number(d) - 1] ?? "")
}
