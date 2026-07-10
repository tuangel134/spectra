/**
 * Claude Code compatibility layer.
 *
 * Imports standalone and installed-plugin assets without executing Claude hooks.
 * MCP definitions are understood too, but are disabled by default until the user
 * opts in with SPECTRA_TRUST_CLAUDE_MCP=1 or overrides the entry in Spectra config.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { homedir } from "node:os"
import type { AgentConfig, McpServerConfigShape } from "../config/types.js"
import { parseJsonc } from "../config/loader.js"

interface ParsedMarkdown {
  data: Record<string, string>
  body: string
}

interface InstalledPluginEntry {
  scope?: string
  projectPath?: string
  installPath?: string
  version?: string
  installedAt?: string
  lastUpdated?: string
}

interface InstalledPluginRegistry {
  plugins?: Record<string, InstalledPluginEntry[] | InstalledPluginEntry>
}

export interface ClaudePluginRoot {
  /** Claude registry id, normally plugin@marketplace. */
  id: string
  /** Stable namespace used by Spectra slash commands, agents, skills and MCP. */
  namespace: string
  path: string
}

function parseMarkdown(raw: string): ParsedMarkdown {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { data: {}, body: normalized.trim() }
  const data: Record<string, string> = {}
  let listKey: string | null = null
  for (const line of match[1]!.split("\n")) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (pair) {
      const key = pair[1]!.toLowerCase()
      const value = pair[2]!.trim().replace(/^['"]|['"]$/g, "")
      data[key] = value
      listKey = value ? null : key
      continue
    }
    const item = line.match(/^\s*-\s*(.+?)\s*$/)
    if (item && listKey) data[listKey] = [data[listKey], item[1]].filter(Boolean).join(",")
  }
  return { data, body: (match[2] ?? "").trim() }
}

function list(value: string | undefined): string[] {
  if (!value) return []
  return value.replace(/^\[/, "").replace(/\]$/, "").split(",")
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
}

function expandHome(path: string, home: string): string {
  if (path === "~") return home
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(home, path.slice(2))
  return path
}

function readObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    const parsed = parseJsonc(readFileSync(path, "utf-8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function enabledPluginMap(projectRoot: string, home: string): Record<string, boolean> {
  const enabled: Record<string, boolean> = {}
  // Later scopes override earlier scopes. Local is the final per-machine veto.
  for (const path of [
    join(home, ".claude", "settings.json"),
    join(projectRoot, ".claude", "settings.json"),
    join(projectRoot, ".claude", "settings.local.json"),
  ]) {
    const value = readObject(path)["enabledPlugins"]
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    for (const [id, state] of Object.entries(value as Record<string, unknown>)) {
      if (typeof state === "boolean") enabled[id] = state
    }
  }
  return enabled
}

function matchesScope(entry: InstalledPluginEntry, projectRoot: string): boolean {
  if (!entry.scope || entry.scope === "user") return true
  if (entry.scope !== "project" && entry.scope !== "local") return true
  if (!entry.projectPath) return false
  return resolve(entry.projectPath) === resolve(projectRoot)
}

function newest(entries: InstalledPluginEntry[]): InstalledPluginEntry | undefined {
  return [...entries].sort((a, b) => {
    const av = Date.parse(a.lastUpdated ?? a.installedAt ?? "") || 0
    const bv = Date.parse(b.lastUpdated ?? b.installedAt ?? "") || 0
    return bv - av
  })[0]
}

/** Discover Claude marketplace plugins that are installed and enabled for this project. */
export function discoverClaudePluginRoots(projectRoot: string, home = homedir()): ClaudePluginRoot[] {
  const registryPath = join(home, ".claude", "plugins", "installed_plugins.json")
  const registry = readObject(registryPath) as InstalledPluginRegistry
  const enabled = enabledPluginMap(projectRoot, home)
  const roots: ClaudePluginRoot[] = []

  for (const [id, rawEntries] of Object.entries(registry.plugins ?? {})) {
    if (enabled[id] === false) continue
    const entries = (Array.isArray(rawEntries) ? rawEntries : [rawEntries])
      .filter((entry) => matchesScope(entry, projectRoot))
      .filter((entry) => typeof entry.installPath === "string" && entry.installPath.length > 0)
    const selected = newest(entries)
    if (!selected?.installPath) continue
    const path = resolve(expandHome(selected.installPath, home))
    try {
      if (!existsSync(path) || !statSync(path).isDirectory()) continue
    } catch {
      continue
    }
    roots.push({ id, namespace: id.split("@")[0] || id, path })
  }
  return roots.sort((a, b) => a.id.localeCompare(b.id))
}


export type ClaudePluginComponent = "skills" | "commands" | "agents"

function manifestValues(value: unknown): string[] {
  if (typeof value === "string") return [value]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function safePluginPath(pluginRoot: string, relativePath: string): string | null {
  if (!relativePath.startsWith("./")) return null
  const root = resolve(pluginRoot)
  const candidate = resolve(root, relativePath)
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null
}

/** Resolve default and manifest-defined Claude plugin component paths safely. */
export function claudePluginComponentPaths(
  plugin: ClaudePluginRoot,
  component: ClaudePluginComponent,
): string[] {
  const manifest = readObject(join(plugin.path, ".claude-plugin", "plugin.json"))
  const configured = manifestValues(manifest[component])
  const paths: string[] = []

  // Skills add to the default directory. Commands and agents replace their
  // default directory when the manifest declares explicit paths.
  if (component === "skills" || configured.length === 0) {
    paths.push(join(plugin.path, component))
  }
  if (component === "skills" && configured.length === 0 && !existsSync(join(plugin.path, "skills"))) {
    paths.push(join(plugin.path, "SKILL.md"))
  }
  for (const value of configured) {
    const path = safePluginPath(plugin.path, value)
    if (path) paths.push(path)
  }
  return [...new Set(paths)]
}

const TOOL_MAP: Record<string, string> = {
  read: "read",
  write: "write",
  edit: "edit",
  multiedit: "multiedit",
  notebookedit: "edit",
  bash: "bash",
  powershell: "bash",
  grep: "grep",
  glob: "glob",
  webfetch: "webfetch",
  websearch: "websearch",
  task: "task",
  skill: "skill",
}

function mapTools(tools: string[]): string[] | undefined {
  const mapped = tools
    .map((tool) => tool.replace(/\(.*/, "").trim().toLowerCase())
    .map((tool) => TOOL_MAP[tool] ?? (tool.startsWith("mcp__") ? tool : ""))
    .filter(Boolean)
  return mapped.length ? [...new Set(mapped)] : undefined
}

function mapModel(model: string | undefined): string | undefined {
  if (!model || model === "inherit") return undefined
  // Claude aliases are provider-specific; inherit Spectra's selected model.
  if (["sonnet", "opus", "haiku"].includes(model.toLowerCase())) return undefined
  return model.includes("/") ? model : undefined
}


function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function deniedPermissions(value: string | undefined): Record<string, "deny"> | undefined {
  const tools = mapTools(list(value))
  if (!tools?.length) return undefined
  return Object.fromEntries(tools.map((tool) => [tool, "deny"]))
}

function loadAgentFile(
  path: string,
  agents: Record<string, AgentConfig>,
  namespace?: string,
): void {
  try {
    const { data, body } = parseMarkdown(readFileSync(path, "utf-8"))
    const file = path.split(/[\\/]/).pop() ?? "agent.md"
    const localId = (data["name"] || file.replace(/\.md$/, "")).trim()
    const id = namespace ? `${namespace}:${localId}` : localId
    if (!localId || !body) return
    agents[id] = {
      description: data["description"] || `Claude-compatible subagent: ${id}`,
      mode: "subagent",
      prompt: body,
      model: mapModel(data["model"]),
      tools: mapTools(list(data["tools"])),
      steps: positiveInt(data["maxturns"] ?? data["max-turns"]),
      permission: deniedPermissions(data["disallowedtools"] ?? data["disallowed-tools"]),
    }
  } catch {
    // One malformed community agent must not prevent Spectra from starting.
  }
}

function loadAgentDirectory(
  dir: string,
  agents: Record<string, AgentConfig>,
  namespace?: string,
): void {
  if (!existsSync(dir)) return
  let files: string[]
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".md")).sort()
  } catch {
    return
  }
  for (const file of files) loadAgentFile(join(dir, file), agents, namespace)
}

export function loadClaudeAgents(projectRoot: string, home = homedir()): Record<string, AgentConfig> {
  const agents: Record<string, AgentConfig> = {}
  // User assets are lowest precedence, project assets highest.
  loadAgentDirectory(join(home, ".claude", "agents"), agents)
  for (const plugin of discoverClaudePluginRoots(projectRoot, home)) {
    for (const path of claudePluginComponentPaths(plugin, "agents")) {
      if (!existsSync(path)) continue
      try {
        if (statSync(path).isDirectory()) loadAgentDirectory(path, agents, plugin.namespace)
        else if (path.endsWith(".md")) loadAgentFile(path, agents, plugin.namespace)
      } catch {
        // Ignore a stale plugin path.
      }
    }
  }
  loadAgentDirectory(join(projectRoot, ".claude", "agents"), agents)
  return agents
}

function substituteRoot(value: unknown, pluginRoot: string, projectRoot: string): unknown {
  if (typeof value === "string") {
    return value
      .replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot)
      .replaceAll("${CLAUDE_PROJECT_DIR}", projectRoot)
  }
  if (Array.isArray(value)) return value.map((item) => substituteRoot(item, pluginRoot, projectRoot))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key, substituteRoot(item, pluginRoot, projectRoot)]))
}

function normalizeMcp(
  source: unknown,
  projectRoot: string,
  pluginRoot?: string,
): Record<string, McpServerConfigShape> {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {}
  const trusted = process.env["SPECTRA_TRUST_CLAUDE_MCP"] === "1"
  const out: Record<string, McpServerConfigShape> = {}
  for (const [name, raw] of Object.entries(source as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const expanded = (pluginRoot ? substituteRoot(raw, pluginRoot, projectRoot) : raw) as McpServerConfigShape
    out[name] = trusted ? expanded : { ...expanded, disabled: true }
  }
  return out
}

function readMcpFile(path: string, projectRoot: string, pluginRoot?: string): Record<string, McpServerConfigShape> {
  const parsed = readObject(path)
  return normalizeMcp(parsed["mcpServers"] ?? parsed["mcp"] ?? parsed, projectRoot, pluginRoot)
}

/** Claude project and installed-plugin MCP definitions; disabled until explicitly trusted. */
export function loadClaudeMcp(projectRoot: string, home = homedir()): Record<string, McpServerConfigShape> {
  const result: Record<string, McpServerConfigShape> = {
    ...readMcpFile(join(projectRoot, ".mcp.json"), projectRoot),
  }
  for (const plugin of discoverClaudePluginRoots(projectRoot, home)) {
    const manifest = readObject(join(plugin.path, ".claude-plugin", "plugin.json"))
    const sources: Record<string, McpServerConfigShape>[] = [
      readMcpFile(join(plugin.path, ".mcp.json"), projectRoot, plugin.path),
    ]
    const declared = manifest["mcpServers"]
    if (typeof declared === "string" || Array.isArray(declared)) {
      for (const value of manifestValues(declared)) {
        const path = safePluginPath(plugin.path, value)
        if (path) sources.push(readMcpFile(path, projectRoot, plugin.path))
      }
    } else {
      sources.push(normalizeMcp(declared, projectRoot, plugin.path))
    }
    const merged: Record<string, McpServerConfigShape> = {}
    for (const source of sources) Object.assign(merged, source)
    for (const [name, config] of Object.entries(merged)) {
      result[`${plugin.namespace}:${name}`] = config
    }
  }
  return result
}

function pluginHasExecutableAssets(path: string): boolean {
  return ["hooks", ".mcp.json", "lsp", "monitors"].some((name) => existsSync(join(path, name)))
}

export interface ClaudeCompatibilitySummary {
  agents: Record<string, AgentConfig>
  mcp: Record<string, McpServerConfigShape>
  plugins: ClaudePluginRoot[]
  executableAssetsDetected: boolean
}

export function loadClaudeCompatibility(projectRoot: string, home = homedir()): ClaudeCompatibilitySummary {
  const plugins = discoverClaudePluginRoots(projectRoot, home)
  const settingsPaths = [
    join(home, ".claude", "settings.json"),
    join(projectRoot, ".claude", "settings.json"),
    join(projectRoot, ".claude", "settings.local.json"),
  ]
  let executableAssetsDetected = plugins.some((plugin) => pluginHasExecutableAssets(plugin.path))
  for (const path of settingsPaths) {
    const settings = readObject(path)
    if (settings["hooks"] || settings["plugins"] || settings["enabledPlugins"]) executableAssetsDetected = true
  }
  return {
    agents: loadClaudeAgents(projectRoot, home),
    mcp: loadClaudeMcp(projectRoot, home),
    plugins,
    executableAssetsDetected,
  }
}
