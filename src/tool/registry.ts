/**
 * Tool registry.
 *
 * Holds the set of tools available to the agent and exposes them both as
 * executable handlers and as schemas advertised to the model.
 */

import type { Tool, ToolCategory } from "./types.js"
import type { ToolSchema } from "../provider/types.js"

export interface ToolSchemaExport {
  name: string
  category: ToolCategory
  description: string
}

import { readTool } from "./read.js"
import { writeTool } from "./write.js"
import { editTool } from "./edit.js"
import { bashTool } from "./bash.js"
import { grepTool } from "./grep.js"
import { globTool } from "./glob.js"
import { webfetchTool } from "./webfetch.js"
import { websearchTool } from "./websearch.js"
import { todoWriteTool, todoReadTool } from "./todo.js"
import { headroomRetrieveTool } from "./headroom-retrieve.js"
import { stealthFetchTool } from "./stealth-fetch.js"
import { gitTools } from "./git.js"
import { browserTool } from "./browser.js"
import { computerTool } from "./computer.js"
import { securityScanTool } from "./security.js"

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>()

  constructor(tools: Tool[] = ToolRegistry.builtins()) {
    for (const tool of tools) this.tools.set(tool.name, tool)
  }

  static builtins(): Tool[] {
    return [readTool, writeTool, editTool, bashTool, grepTool, globTool, webfetchTool, websearchTool, todoWriteTool, todoReadTool, stealthFetchTool, browserTool, computerTool, securityScanTool, headroomRetrieveTool, ...gitTools]
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  list(): Tool[] {
    return Array.from(this.tools.values())
  }

  /** Build the schema array advertised to the model, filtered by allowed names. */
  schemas(allowed?: (name: string) => boolean): ToolSchema[] {
    return this.list()
      .filter((t) => (allowed ? allowed(t.name) : true))
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))
  }

  /** Export tool metadata for display. */
  describe(): ToolSchemaExport[] {
    return this.list().map((t) => ({
      name: t.name,
      category: t.category,
      description: t.description,
    }))
  }
}
