/**
 * Spectra runtime.
 *
 * Wires together all subsystems (config, providers, agents, tools, sessions,
 * specs, hooks) into a single object the CLI and server can use.
 */

import { loadConfig, type LoadedConfig } from "./config/loader.js"
import { ProviderRegistry } from "./provider/registry.js"
import { AgentRegistry } from "./agent/registry.js"
import { ToolRegistry } from "./tool/registry.js"
import { SessionManager } from "./session/manager.js"
import { AgentLoop, type LoopDeps } from "./session/loop.js"
import { SpecEngine } from "./spec/engine.js"
import { HookRegistry } from "./hook/index.js"
import { Headroom } from "./headroom/index.js"
import { AutorunManager } from "./autorun/index.js"
import { McpManager } from "./mcp/index.js"
import { SkillRegistry, createSkillTool } from "./skill/index.js"
import { LspManager, createDiagnosticsTool } from "./lsp/index.js"
import { createTaskTool } from "./tool/task.js"
import { PluginManager } from "./plugin/index.js"
import { ModelRouter, type RoutingConfig } from "./routing/index.js"
import { MemoryStore, createMemoryTool } from "./memory/index.js"

export interface AuditEntry {
  id: string
  category: string
  action: string
  detail?: string
  timestamp: number
}

export interface Runtime {
  config: LoadedConfig
  providers: ProviderRegistry
  agents: AgentRegistry
  tools: ToolRegistry
  sessions: SessionManager
  loop: AgentLoop
  specs: SpecEngine
  hooks: HookRegistry
  headroom: Headroom
  autorun: AutorunManager
  mcp: McpManager
  skills: SkillRegistry
  lsp: LspManager
  plugins: PluginManager
  router: ModelRouter
  memory: MemoryStore
  audit: AuditEntry[]
  pushAudit(category: string, action: string, detail?: string): void
}

export function createRuntime(options: { cwd?: string; configPath?: string } = {}): Runtime {
  const loaded = loadConfig(options)
  const { config, projectRoot } = loaded

  const providers = new ProviderRegistry(config)
  const agents = new AgentRegistry(config)
  const tools = new ToolRegistry()
  const sessions = new SessionManager()
  sessions.enablePersistence(projectRoot)
  const hooks = new HookRegistry(projectRoot)
  const headroom = new Headroom(config.headroom, projectRoot)
  const skills = new SkillRegistry(projectRoot)
  const mcp = new McpManager(projectRoot, config.mcp)
  const lsp = new LspManager(projectRoot)
  const plugins = new PluginManager(projectRoot, tools)
  const router = new ModelRouter(
    () => config.routing as RoutingConfig,
    () => config.model,
    () => config.small_model ?? config.model,
  )
  const memory = new MemoryStore(projectRoot)

  // Register the skill tool (skills are discovered from disk).
  tools.register(createSkillTool(skills))
  // Register the diagnostics tool (LSP-backed).
  tools.register(createDiagnosticsTool(lsp, projectRoot))
  // Register the project-memory tool.
  tools.register(createMemoryTool(memory))

  const specs = new SpecEngine({
    projectRoot,
    outputDir: config.spec.outputDir,
    maxParallelTasks: config.spec.maxParallelTasks,
  })

  const loopDeps: LoopDeps = {
    providers,
    tools,
    sessions,
    globalPermissions: config.permission,
    // Read the project root dynamically from the loaded config so tools that
    // temporarily retarget it (e.g. the benchmark harness running in a throwaway
    // temp dir) actually sandbox the agent there instead of the real project.
    get projectRoot() {
      return loaded.projectRoot
    },
    compaction: config.compaction,
    headroom,
    router,
    autoApprove: () => config.autoApprove,
    hooks,
  }
  const loop = new AgentLoop(loopDeps)

  const audit: AuditEntry[] = []
  const pushAudit = (category: string, action: string, detail?: string): void => {
    audit.unshift({
      id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      category,
      action,
      detail,
      timestamp: Date.now(),
    })
    if (audit.length > 200) audit.pop()
  }

  const runtime: Runtime = {
    config: loaded,
    providers,
    agents,
    tools,
    sessions,
    loop,
    specs,
    hooks,
    headroom,
    autorun: undefined as unknown as AutorunManager,
    mcp,
    skills,
    lsp,
    plugins,
    router,
    memory,
    audit,
    pushAudit,
  }
  runtime.autorun = new AutorunManager(runtime, config.autorun)
  // The task tool delegates to subagents via the loop, so it needs the runtime.
  runtime.tools.register(createTaskTool(runtime))
  return runtime
}

/**
 * Switch the runtime to a different project root WITHOUT restarting the process.
 *
 * Tears down the current project's live integrations (autorun, MCP, LSP) and
 * flushes its sessions, then rebuilds every subsystem for the new root and
 * assigns them onto the SAME `rt` object — so all server handlers (which read
 * `rt.<subsystem>` per request) transparently start serving the new project,
 * including auto-resuming its most recent session.
 *
 * Call `connectIntegrations(rt)` afterwards to (re)connect MCP/plugins.
 */
export function reloadRuntime(rt: Runtime, options: { cwd?: string; configPath?: string } = {}): void {
  // Tear down the old project's live state.
  try { rt.autorun?.cancel() } catch { /* ignore */ }
  try { rt.sessions?.flush() } catch { /* ignore */ }
  try { rt.mcp?.close() } catch { /* ignore */ }
  try { rt.lsp?.close() } catch { /* ignore */ }
  // Plugins need no explicit teardown: they hold no long-lived resources (their
  // init timer is cleared on load) and the tools they registered live on the
  // old ToolRegistry, which is replaced wholesale below.

  const fresh = createRuntime(options)
  rt.config = fresh.config
  rt.providers = fresh.providers
  rt.agents = fresh.agents
  rt.tools = fresh.tools
  rt.sessions = fresh.sessions
  rt.loop = fresh.loop
  rt.specs = fresh.specs
  rt.hooks = fresh.hooks
  rt.headroom = fresh.headroom
  rt.autorun = fresh.autorun
  rt.mcp = fresh.mcp
  rt.skills = fresh.skills
  rt.lsp = fresh.lsp
  rt.plugins = fresh.plugins
  rt.router = fresh.router
  rt.memory = fresh.memory
  rt.audit = fresh.audit
  rt.pushAudit = fresh.pushAudit
}

/**
 * Connect external integrations that require async setup (MCP servers).
 * Call once after createRuntime, before starting the TUI/server. Best-effort:
 * a failing MCP server never blocks startup.
 */
export async function connectIntegrations(
  rt: Runtime,
  report?: (msg: string) => void,
): Promise<void> {
  try {
    await rt.mcp.connectAll(report)
    const mcpTools = rt.mcp.toTools()
    for (const tool of mcpTools) rt.tools.register(tool)
    if (mcpTools.length > 0) rt.pushAudit("mcp", `Connected ${mcpTools.length} MCP tool(s)`)
  } catch (err) {
    report?.(`MCP init error: ${(err as Error).message}`)
  }
  try {
    const plugins = await rt.plugins.loadAll()
    const ok = plugins.filter((p) => !p.error)
    if (ok.length > 0) rt.pushAudit("plugin", `Loaded ${ok.length} plugin(s)`)
  } catch (err) {
    report?.(`Plugin init error: ${(err as Error).message}`)
  }
  // Refresh the free-model list from OpenCode's live catalog (best-effort,
  // cached for a day). Keeps the free tier accurate without a Spectra update.
  try {
    const { refreshFreeModels } = await import("./provider/free-models.js")
    const models = await refreshFreeModels()
    report?.(`Free models: ${models.length} available`)
  } catch {
    /* best-effort — falls back to cache/bundled */
  }
}
