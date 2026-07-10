import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { EcosystemInventory, EcosystemItem } from "./types.js"

function exists(file: string): boolean { try { return fs.existsSync(file) } catch { return false } }
function namesIn(dir: string, extension?: string): string[] {
  if (!exists(dir)) return []
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || (!extension || entry.name.endsWith(extension)))
      .map((entry) => entry.name.replace(extension ? new RegExp(`${extension.replace(".", "\\.")}$`) : /$^/, ""))
  } catch { return [] }
}

export function scanEcosystem(projectRoot: string, home = os.homedir()): EcosystemInventory {
  const items: EcosystemItem[] = []
  const addDir = (kind: EcosystemItem["kind"], dir: string, source: EcosystemItem["source"], extension?: string) => {
    for (const name of namesIn(dir, extension)) items.push({ kind, name, source, path: path.join(dir, extension ? `${name}${extension}` : name), enabled: true })
  }
  addDir("skill", path.join(projectRoot, ".spectra", "skills"), "spectra")
  addDir("skill", path.join(projectRoot, ".claude", "skills"), "claude")
  addDir("skill", path.join(home, ".claude", "skills"), "user")
  addDir("agent", path.join(projectRoot, ".spectra", "agents"), "spectra", ".md")
  addDir("agent", path.join(projectRoot, ".claude", "agents"), "claude", ".md")
  addDir("command", path.join(projectRoot, ".spectra", "commands"), "spectra", ".md")
  addDir("command", path.join(projectRoot, ".claude", "commands"), "claude", ".md")
  addDir("plugin", path.join(projectRoot, ".spectra", "plugins"), "spectra")
  const mcpFiles = [path.join(projectRoot, ".spectra", "mcp.json"), path.join(projectRoot, ".mcp.json"), path.join(projectRoot, ".claude", "mcp.json")]
  for (const file of mcpFiles) if (exists(file)) items.push({ kind: "mcp", name: path.basename(file), source: file.includes(".claude") ? "claude" : "project", path: file, enabled: true })
  const counts: EcosystemInventory["counts"] = { skill: 0, agent: 0, plugin: 0, mcp: 0, command: 0 }
  for (const item of items) counts[item.kind]++
  return { items, counts }
}
