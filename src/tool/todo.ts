/**
 * todowrite / todoread — a lightweight task list the agent maintains while
 * working on a multi-step job. Writing the plan up front (and checking items
 * off) keeps long tasks on track and gives the user visible progress — the same
 * pattern Claude Code's TodoWrite uses.
 *
 * The list is per-project and in-memory (resets on restart); it's a working
 * scratchpad, not durable state.
 */

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"

export type TodoStatus = "pending" | "in_progress" | "completed"
export interface TodoItem {
  content: string
  status: TodoStatus
}

const store = new Map<string, TodoItem[]>()

/** Test/inspection helper. */
export function getTodos(projectRoot: string): TodoItem[] {
  return store.get(projectRoot) ?? []
}

function render(items: TodoItem[]): string {
  if (items.length === 0) return "(todo list is empty)"
  const icon = (s: TodoStatus): string => (s === "completed" ? "✅" : s === "in_progress" ? "🔄" : "⬜")
  const done = items.filter((t) => t.status === "completed").length
  return (
    `Tasks (${done}/${items.length} done):\n` +
    items.map((t) => `${icon(t.status)} ${t.content}`).join("\n")
  )
}

export const todoWriteTool: Tool = {
  name: "todowrite",
  description:
    "Create or update the working task list for the current job. Pass the FULL list each time " +
    "(it replaces the previous one). Use it to plan multi-step work and mark items in_progress/completed " +
    "as you go. Keep exactly one item in_progress at a time.",
  category: "meta",
  availableToSubagents: true,
  parameters: objectSchema(
    {
      todos: {
        type: "array",
        description: "The complete task list",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "What the task is" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["content", "status"],
        },
      },
    },
    ["todos"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const raw = Array.isArray(args["todos"]) ? (args["todos"] as Record<string, unknown>[]) : null
    if (!raw) return { success: false, output: "Error: 'todos' must be an array." }
    const items: TodoItem[] = raw.map((t) => {
      const status = String(t["status"] ?? "pending") as TodoStatus
      return {
        content: String(t["content"] ?? "").trim(),
        status: ["pending", "in_progress", "completed"].includes(status) ? status : "pending",
      }
    }).filter((t) => t.content.length > 0)
    store.set(ctx.projectRoot, items)
    const done = items.filter((t) => t.status === "completed").length
    const active = items.find((t) => t.status === "in_progress")
    ctx.report(`📋 todo: ${done}/${items.length} done${active ? ` · now: ${active.content}` : ""}`)
    return { success: true, output: render(items) }
  },
}

export const todoReadTool: Tool = {
  name: "todoread",
  description: "Read the current working task list (see what's done, in progress, and pending).",
  category: "meta",
  availableToSubagents: true,
  parameters: objectSchema({}, []),

  async execute(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return { success: true, output: render(store.get(ctx.projectRoot) ?? []) }
  },
}
