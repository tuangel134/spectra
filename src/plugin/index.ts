/**
 * Plugin system.
 *
 * Project plugins are executable JavaScript and therefore participate in
 * Workspace Trust. The manager still discovers blocked plugins so Desktop can
 * explain what is present without importing untrusted code.
 */
import { readdirSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { Tool } from "../tool/types.js"
import type { ToolRegistry } from "../tool/registry.js"

export interface PluginApi {
  registerTool(tool: Tool): void
  projectRoot: string
  log(message: string): void
}

export interface LoadedPlugin {
  name: string
  path: string
  tools: string[]
  error?: string
  blocked?: boolean
}

export type PluginModule = (api: PluginApi) => void | Promise<void>

export class PluginManager {
  private readonly dir: string
  private readonly loaded: LoadedPlugin[] = []

  constructor(
    private readonly projectRoot: string,
    private readonly tools: ToolRegistry,
    private readonly logger: (msg: string) => void = () => {},
    private readonly canLoad: () => boolean = () => true,
  ) {
    this.dir = join(projectRoot, ".spectra", "plugins")
  }

  /** Discover and load every plugin module. Best-effort and trust-gated. */
  async loadAll(): Promise<LoadedPlugin[]> {
    this.loaded.length = 0
    if (!existsSync(this.dir)) return this.loaded

    let entries: string[]
    try {
      entries = readdirSync(this.dir).sort()
    } catch {
      return this.loaded
    }

    const candidates: Array<{ name: string; full: string }> = []
    for (const entry of entries) {
      if (!/\.(mjs|js|cjs)$/.test(entry)) continue
      const full = join(this.dir, entry)
      try {
        if (!statSync(full).isFile()) continue
      } catch {
        continue
      }
      candidates.push({ name: entry, full })
    }

    if (!this.canLoad()) {
      for (const candidate of candidates) {
        this.loaded.push({
          name: candidate.name,
          path: candidate.full,
          tools: [],
          blocked: true,
          error: "Blocked by Workspace Trust",
        })
      }
      return this.loaded
    }

    for (const candidate of candidates) await this.loadOne(candidate.name, candidate.full)
    return this.loaded
  }

  private async loadOne(name: string, full: string): Promise<void> {
    const registered: string[] = []
    const api: PluginApi = {
      projectRoot: this.projectRoot,
      log: (msg: string) => this.logger(`[plugin:${name}] ${msg}`),
      registerTool: (tool: Tool) => {
        if (!tool || typeof tool.name !== "string" || typeof tool.execute !== "function") {
          throw new Error("registerTool requires { name, execute }")
        }
        const guarded: Tool = {
          ...tool,
          execute: async (args, ctx) => {
            if (!this.canLoad()) {
              return {
                success: false,
                output: "Blocked by Workspace Trust. Re-trust the workspace before using plugin tools.",
              }
            }
            return await tool.execute(args, ctx)
          },
        }
        this.tools.register(guarded)
        registered.push(tool.name)
      },
    }

    try {
      const mod = (await import(pathToFileURL(full).href)) as { default?: PluginModule }
      const fn = mod.default
      if (typeof fn !== "function") throw new Error("plugin must default-export a function")

      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.resolve(fn(api)),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("plugin init timed out after 10s")), 10_000)
          }),
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }

      this.loaded.push({ name, path: full, tools: registered })
      this.logger(`Loaded plugin "${name}" (+${registered.length} tools)`)
    } catch (err) {
      this.loaded.push({
        name,
        path: full,
        tools: registered,
        error: (err as Error).message,
      })
      this.logger(`Plugin "${name}" failed: ${(err as Error).message}`)
    }
  }

  list(): LoadedPlugin[] {
    return this.loaded
  }
}
