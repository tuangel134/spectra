/**
 * Project memory.
 *
 * A persistent, cross-session store of durable facts about a project —
 * decisions, conventions, APIs, and important files — so the agent doesn't
 * re-learn the project every session. Stored at `.spectra/memory.json`.
 *
 * The agent reads/writes it through the `memory` tool (remember / recall /
 * forget / list), giving progressive disclosure: it recalls only what's
 * relevant to the current query instead of dumping everything into context.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"

import type { Tool, ToolContext, ToolResult } from "../tool/types.js"
import { objectSchema } from "../tool/types.js"
import { generateId } from "../util/id.js"

export type MemoryKind = "decision" | "fact" | "convention" | "api" | "file" | "todo"

export interface MemoryEntry {
  id: string
  kind: MemoryKind
  text: string
  tags: string[]
  createdAt: number
}

const KINDS: MemoryKind[] = ["decision", "fact", "convention", "api", "file", "todo"]
const MAX_ENTRIES = 1000

export class MemoryStore {
  private readonly path: string
  private entries: MemoryEntry[]

  constructor(projectRoot: string) {
    this.path = join(projectRoot, ".spectra", "memory.json")
    this.entries = this.load()
  }

  private load(): MemoryEntry[] {
    if (!existsSync(this.path)) return []
    try {
      const data = JSON.parse(readFileSync(this.path, "utf-8")) as { entries?: MemoryEntry[] }
      return Array.isArray(data.entries) ? data.entries : []
    } catch {
      return []
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify({ entries: this.entries }, null, 2), "utf-8")
  }

  remember(kind: MemoryKind, text: string, tags: string[] = []): MemoryEntry {
    const entry: MemoryEntry = {
      id: generateId("mem"),
      kind,
      text: text.trim(),
      tags: tags.map((t) => t.toLowerCase().trim()).filter(Boolean),
      createdAt: Date.now(),
    }
    // De-dupe near-identical text within the same kind.
    this.entries = this.entries.filter((e) => !(e.kind === kind && e.text === entry.text))
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    this.persist()
    return entry
  }

  forget(id: string): boolean {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.id !== id)
    if (this.entries.length !== before) {
      this.persist()
      return true
    }
    return false
  }

  /** Rank entries by simple term overlap with the query (and tag matches). */
  recall(query: string, limit = 12): MemoryEntry[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return this.list().slice(0, limit)
    const scored = this.entries.map((e) => {
      const hay = `${e.text} ${e.tags.join(" ")} ${e.kind}`.toLowerCase()
      let score = 0
      for (const t of terms) if (hay.includes(t)) score++
      return { e, score }
    })
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.e.createdAt - a.e.createdAt)
      .slice(0, limit)
      .map((s) => s.e)
  }

  list(): MemoryEntry[] {
    return [...this.entries].sort((a, b) => b.createdAt - a.createdAt)
  }

  reload(): void {
    this.entries = this.load()
  }
}

/** Build the `memory` tool bound to a store. */
export function createMemoryTool(store: MemoryStore): Tool {
  return {
    name: "memory",
    description:
      "Persistent project memory across sessions. action=remember stores a durable fact " +
      "(decision/convention/api/file/fact/todo); action=recall searches it; action=list shows all; " +
      "action=forget removes one by id. Use it to avoid re-learning the project.",
    category: "meta",
    availableToSubagents: true,
    parameters: objectSchema(
      {
        action: { type: "string", enum: ["remember", "recall", "list", "forget"], description: "Operation" },
        kind: { type: "string", enum: KINDS, description: "Entry kind (for remember)" },
        text: { type: "string", description: "The fact to store (for remember)" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
        query: { type: "string", description: "Search query (for recall)" },
        id: { type: "string", description: "Entry id (for forget)" },
      },
      ["action"],
    ),
    async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const action = String(args["action"] ?? "")
      const fmt = (e: MemoryEntry): string => `[${e.kind}] ${e.text}${e.tags.length ? `  (#${e.tags.join(" #")})` : ""}  ‹${e.id}›`

      if (action === "remember") {
        const text = String(args["text"] ?? "").trim()
        if (!text) return { success: false, output: "Error: 'text' is required for remember." }
        const kind = (KINDS.includes(args["kind"] as MemoryKind) ? args["kind"] : "fact") as MemoryKind
        const tags = Array.isArray(args["tags"]) ? (args["tags"] as string[]) : []
        const entry = store.remember(kind, text, tags)
        return { success: true, output: `Remembered: ${fmt(entry)}`, metadata: { id: entry.id } }
      }
      if (action === "recall") {
        const hits = store.recall(String(args["query"] ?? ""))
        return {
          success: true,
          output: hits.length ? hits.map(fmt).join("\n") : "(no matching memory)",
        }
      }
      if (action === "list") {
        const all = store.list()
        return { success: true, output: all.length ? all.map(fmt).join("\n") : "(memory is empty)" }
      }
      if (action === "forget") {
        const id = String(args["id"] ?? "")
        const ok = store.forget(id)
        return { success: ok, output: ok ? `Forgot ${id}.` : `No entry ${id}.` }
      }
      return { success: false, output: `Unknown action "${action}".` }
    },
  }
}
