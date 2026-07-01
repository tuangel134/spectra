/**
 * Slash command catalog.
 *
 * Shared metadata for the command palette / autocomplete used by both the TUI
 * and the web UI. The actual handlers live in the TUI app and web server; this
 * is the discoverable list shown when the user types "/".
 */

export type CommandCategory = "spec" | "exec" | "config" | "system" | "git"

export interface CommandMeta {
  command: string
  description: string
  category: CommandCategory
  args?: string
}

export const COMMANDS: CommandMeta[] = [
  // system
  { command: "/help", description: "Show available commands", category: "system" },
  { command: "/init", description: "Analyze project and create AGENTS.md", category: "system" },
  { command: "/clear", description: "Start a new session", category: "system" },
  { command: "/new", description: "Start a new session", category: "system" },
  { command: "/exit", description: "Quit Spectra", category: "system" },
  { command: "/stats", description: "Show token usage this run", category: "system" },
  { command: "/headroom", description: "Show Headroom compression savings this run", category: "system" },
  { command: "/export", description: "Export the conversation to Markdown", category: "system" },
  { command: "/sessions", description: "List sessions — then /resume <number> to switch", category: "system" },
  { command: "/resume", description: "Switch to a past session by number or id", category: "system", args: "<n|id>" },
  { command: "/projects", description: "List your projects", category: "system" },
  { command: "/open", description: "Open/switch to another project (resumes its session)", category: "system", args: "<path>" },
  { command: "/ops", description: "Fix THIS computer: audio, wifi, drivers, services, packages", category: "exec" },
  { command: "/fix", description: "Alias for /ops — diagnose and fix system problems", category: "exec" },

  // config
  { command: "/connect", description: "Connect an AI provider (Zen, Go, OpenAI, Ollama…)", category: "config" },
  { command: "/model", description: "Pick a model from the catalog", category: "config", args: "[id]" },
  { command: "/models", description: "Pick a model from the catalog", category: "config" },
  { command: "/agent", description: "Switch agent", category: "config", args: "[id]" },
  { command: "/mode", description: "Switch agent mode", category: "config", args: "<mode>" },
  { command: "/audit", description: "Security audit: scan the project for vulnerabilities", category: "exec", args: "[scope]" },
  { command: "/permission", description: "Set a tool permission", category: "config", args: "<tool> <level>" },
  { command: "/supervise", description: "Supervised mode: approve edits/commands (on|off)", category: "config", args: "<on|off>" },
  { command: "/routing", description: "Show model routing mode + autochange fallbacks", category: "config" },
  { command: "/cost", description: "Show estimated token cost this run", category: "system" },
  { command: "/mcp", description: "List connected MCP servers and their tools", category: "config" },
  { command: "/skills", description: "List available agent skills", category: "config" },
  { command: "/plugins", description: "List loaded plugins", category: "config" },
  { command: "/eval", description: "Run the capability eval scorecard", category: "system" },
  { command: "/theme", description: "Change the color theme", category: "config", args: "[id]" },
  { command: "/details", description: "Toggle tool execution details", category: "config" },
  { command: "/thinking", description: "Toggle reasoning blocks", category: "config" },

  // spec
  { command: "/spec", description: "Generate a spec (requirements, design, tasks)", category: "spec", args: "<description>" },
  { command: "/specmode", description: "Spec auto-detection: ask | auto | off", category: "config", args: "<mode>" },
  { command: "/run", description: "Execute a spec's tasks in parallel waves", category: "spec", args: "<spec-id>" },
  { command: "/autorun", description: "Full-Stack Autopilot: plan + build a whole project autonomously", category: "spec", args: "<goal>" },
  { command: "/autostop", description: "Pause the running Full-Stack Autopilot", category: "spec" },
  { command: "/autoresume", description: "Resume an interrupted Autopilot run", category: "spec" },

  // exec
  { command: "/undo", description: "Revert the last set of file changes", category: "exec" },
  { command: "/redo", description: "Restore reverted file changes", category: "exec" },
]

/** Filter commands whose name starts with the typed prefix (the first word). */
export function filterCommands(input: string): CommandMeta[] {
  if (!input.startsWith("/")) return []
  const firstWord = input.split(/\s/)[0] ?? input
  // De-dupe by command keeping first occurrence (handles /clear vs /new aliases).
  const seen = new Set<string>()
  const out: CommandMeta[] = []
  for (const c of COMMANDS) {
    if (!c.command.startsWith(firstWord)) continue
    if (seen.has(c.command)) continue
    seen.add(c.command)
    out.push(c)
  }
  return out
}
