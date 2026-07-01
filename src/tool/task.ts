/**
 * task — delegate work to a subagent.
 *
 * Spawns one of the registered subagents (e.g. `explore`, `review`) in an
 * isolated session with its own context budget, runs it to completion, and
 * returns its final answer. This lets the primary agent fan out research or
 * focused edits without bloating its own context — the same pattern Claude Code
 * and OpenCode use for subagents.
 */

import type { Runtime } from "../runtime.js"
import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import type { LoopHandlers } from "../session/loop.js"

const MAX_SUBAGENT_STEPS = 25

/** Build the `task` tool bound to a runtime. */
export function createTaskTool(rt: Runtime): Tool {
  const subagentList = rt.agents
    .subagents()
    .map((a) => `${a.id} (${a.description})`)
    .join("; ")
  return {
    name: "task",
    description:
      "Delegate a focused task to a subagent that runs in its own isolated context " +
      "and returns a single result. Ideal for parallelizable research or scoped edits. " +
      `Available subagents: ${subagentList || "explore, review"}.`,
    category: "meta",
    availableToSubagents: false, // subagents cannot recursively spawn subagents
    parameters: objectSchema(
      {
        agent: {
          type: "string",
          description: "Subagent id (e.g. explore, review). Defaults to explore.",
        },
        description: { type: "string", description: "Short title for the task" },
        prompt: { type: "string", description: "The full instruction for the subagent" },
      },
      ["prompt"],
    ),

    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const prompt = String(args["prompt"] ?? "").trim()
      if (!prompt) return { success: false, output: "Error: 'prompt' is required." }

      const requested = String(args["agent"] ?? "explore").trim()
      const subagent = rt.agents.get(requested)
      if (!subagent) {
        const ids = rt.agents.subagents().map((a) => a.id).join(", ")
        return { success: false, output: `Error: unknown subagent "${requested}". Available: ${ids}` }
      }
      // Guard against runaway recursion and honour the `availableToSubagents`
      // flag: subagents may NOT spawn further tasks. When the subagent has
      // full tool access (allowedTools === null) we must still materialise an
      // explicit allow-list that excludes `task` (and anything else flagged
      // `availableToSubagents: false`) — otherwise `null` would grant it.
      const toolAvailableToSub = (name: string): boolean => rt.tools.get(name)?.availableToSubagents !== false
      const baseTools =
        subagent.allowedTools === null ? rt.tools.list().map((t) => t.name) : subagent.allowedTools
      const agent = {
        ...subagent,
        maxSteps: subagent.maxSteps ?? MAX_SUBAGENT_STEPS,
        allowedTools: baseTools.filter(toolAvailableToSub),
      }

      const title = String(args["description"] ?? subagent.id)
      ctx.report(`delegating to subagent "${subagent.id}": ${title}`)

      const session = rt.sessions.create(agent.id, agent.model ?? rt.config.config.model, undefined, false)
      const handlers: LoopHandlers = {
        onText: () => {},
        onToolStart: () => {},
        onToolEnd: () => {},
        report: (m) => ctx.report(`  [${subagent.id}] ${m}`),
        // Inherit the parent's approval policy for nested actions.
        requestApproval: ctx.requestApproval,
      }

      try {
        const result = await rt.loop.run({
          sessionId: session.id,
          agent,
          userMessage: prompt,
          handlers,
          maxSteps: agent.maxSteps,
        })
        return {
          success: true,
          output: result.finalText || "(subagent produced no text output)",
          metadata: { agent: subagent.id, steps: result.steps, toolCalls: result.toolCalls },
        }
      } catch (err) {
        return { success: false, output: `Subagent "${subagent.id}" failed: ${(err as Error).message}` }
      }
    },
  }
}
