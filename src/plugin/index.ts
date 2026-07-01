/**
 * Plugin system.
 *
 * A plugin is a `.js`/`.mjs` module in `.spectra/plugins/` that default-exports
 * a function receiving a typed API and registering tools (and, in future,
 * providers/hooks). This is how users extend Spectra without forking it — the
 * same extension model OpenCode offers.
 *
 * Example `.spectra/plugins/hello.mjs`:
 *
 *   export default function ({ registerTool, log }) {
 *     registerTool({
 *       name: "hello",
 *       description: "Say hello",
 *       category: "meta",
 *       parameters: { type: "object", properties: {}, additionalProperties: false },
 *       async execute() { return { success: true, output: "hello from a plugin" } },
 *     })
 *   }
 */

import { readdirSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import type { Tool } from "../tool/types.js"
import type { ToolRegistry } from "../tool/registry.js"

export interface PluginApi {
  /** Register a tool the agent can call. */
  registerTool(tool: Tool): void
  /** Absolute path to the project root. */
  projectRoot: string
  /** Structured logger for plugin output. */
  log(message: string): void
}

export interface LoadedPlugin {
  name: string
  path: string
  tools: string[]
  error?: string
}

export type PluginModule = (api: PluginApi) => void | Promise<void>

export class PluginManager {
  private readonly dir: string
  private readonly loaded: LoadedPlugin[] = []

  constructor(
    private readonly projectRoot: string,
    private readonly tools: ToolRegistry,
    private readonly logger: (msg: string) => void = () => {},
  ) {
    this.dir = join(projectRoot, ".spectra", "plugins")
  }

  /** Discover and load every plugin module. Best-effort and isolated. */
  async loadAll(): Promise<LoadedPlugin[]> {
    if (!existsSync(this.dir)) return this.loaded
    let entries: string[]
    try {
      entries = readdirSync(this.dir)
    } catch {
      return this.loaded
    }

    for (const entry of entries) {
      if (!/\.(mjs|js|cjs)$/.test(entry)) continue
      const full = join(this.dir, entry)
      try {
        if (!statSync(full).isFile()) continue
      } catch {
        continue
      }
      await this.loadOne(entry, full)
    }
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
        this.tools.register(tool)
        registered.push(tool.name)
      },
    }
    try {
      const mod = (await import(pathToFileURL(full).href)) as { default?: PluginModule }
      const fn = mod.default
      if (typeof fn !== "function") throw new Error("plugin must default-export a function")
      // Bound the init call so a plugin that never resolves can't stall startup.
      // Clear the timer on completion so it never keeps the event loop alive.
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.resolve(fn(api)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("plugin init timed out after 10s")), 10_000)
          }),
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
      this.loaded.push({ name, path: full, tools: registered })
      this.logger(`Loaded plugin "${name}" (+${registered.length} tools)`)
    } catch (err) {
      this.loaded.push({ name, path: full, tools: registered, error: (err as Error).message })
      this.logger(`Plugin "${name}" failed: ${(err as Error).message}`)
    }
  }

  list(): LoadedPlugin[] {
    return this.loaded
  }
}
