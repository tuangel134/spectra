/**
 * Agent loop.
 *
 * Drives a conversation turn: sends the message history to the model, executes
 * any requested tool calls, feeds results back, and repeats until the model
 * produces a final text answer or the step limit is reached.
 */

import type { ProviderRegistry } from "../provider/registry.js"
import { ProviderError } from "../provider/types.js"
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  ToolCallRequest,
  ResolvedModel,
  Provider,
} from "../provider/types.js"
import type { Agent } from "../agent/types.js"
import type { ToolRegistry } from "../tool/registry.js"
import type { ToolContext } from "../tool/types.js"
import type { SessionManager } from "./manager.js"
import type { FileChange } from "./types.js"
import type { PermissionLevel, PermissionMap } from "../config/types.js"
import { evaluatePermission } from "../permission/index.js"
import { shouldCompact, compact } from "./compaction.js"
import type { Headroom } from "../headroom/index.js"
import { type ModelRouter, type TaskKind, isExhaustionError } from "../routing/index.js"
import type { HookRegistry, HookEvent } from "../hook/index.js"

const DEFAULT_MAX_STEPS = 30

export interface LoopHandlers {
  /** Called with assistant text as it is produced (final / committed). */
  onText(text: string): void
  /** Optional: called with incremental text deltas as they stream in. */
  onTextChunk?(text: string): void
  /** Called before a tool runs. */
  onToolStart(name: string, args: Record<string, unknown>): void
  /** Called after a tool runs. */
  onToolEnd(name: string, success: boolean, output: string): void
  /** Ask the user to approve an action. */
  requestApproval(toolName: string, detail: string): Promise<boolean>
  /** Emit a status/progress line. */
  report(message: string): void
}

export interface LoopDeps {
  providers: ProviderRegistry
  tools: ToolRegistry
  sessions: SessionManager
  globalPermissions: PermissionMap
  projectRoot: string
  /** Auto-compaction settings. */
  compaction?: { auto: boolean; reserved: number }
  /** Headroom context-compression layer (compresses tool output). */
  headroom?: Headroom
  /** Model router for semi-auto/auto selection and autochange failover. */
  router?: ModelRouter
  /** Live getter for the interactive auto-approve toggle. */
  autoApprove?: () => boolean
  /** Event-driven hooks fired around prompts, tools and file changes. */
  hooks?: HookRegistry
}

export interface LoopOptions {
  sessionId: string
  agent: Agent
  /** The user's input message. */
  userMessage: string
  /** Optional images attached to the user message (multimodal). */
  images?: import("../provider/types.js").ImagePart[]
  /** Task kind for model routing (plan/build/fix/…). Defaults to "build". */
  taskKind?: TaskKind
  handlers: LoopHandlers
  maxSteps?: number
  /** External abort signal — cancels the turn between steps and the in-flight request. */
  signal?: AbortSignal
}

export interface LoopResult {
  finalText: string
  steps: number
  toolCalls: number
  changes: FileChange[]
}

export class AgentLoop {
  constructor(private readonly deps: LoopDeps) {}

  async run(options: LoopOptions): Promise<LoopResult> {
    const { sessionId, agent, userMessage, handlers } = options
    const session = this.deps.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    // Append the user message.
    this.deps.sessions.addMessage(sessionId, { role: "user", content: userMessage, images: options.images })

    const modelString = agent.model ?? session.model
    const taskKind: TaskKind = options.taskKind ?? "build"
    // The ordered model chain: primary pick + autochange fallbacks. When no
    // router is configured or the agent pins a model, it's just the one model.
    const chain = agent.model
      ? [agent.model]
      : this.deps.router
        ? this.deps.router.chain(taskKind, { text: userMessage })
        : [modelString]
    // Primary resolution (used for compaction window sizing).
    const resolved = this.deps.providers.resolve(chain[0]!)
    const client = this.deps.providers.client(resolved)

    const allowedTools = (name: string): boolean =>
      agent.allowedTools === null || agent.allowedTools.includes(name)

    const toolSchemas = this.deps.tools.schemas(allowedTools)

    const maxSteps = options.maxSteps ?? agent.maxSteps ?? DEFAULT_MAX_STEPS
    const accumulatedChanges: FileChange[] = []
    let totalToolCalls = 0
    let finalText = ""
    let step = 0
    /** Tracks repeated identical tool calls to break self-loops. */
    const repeatCounts = new Map<string, number>()

    const ctx: ToolContext = {
      projectRoot: this.deps.projectRoot,
      agentId: agent.id,
      requestApproval: (toolName: string, detail: string, mandatory?: boolean): Promise<boolean> => {
        // An "ask" declared by the AGENT ITSELF is a hard human gate and is
        // never bypassed by auto-approve (e.g. the security/plan/review/ops
        // agents that deliberately require confirmation before a privileged or
        // destructive action). Only "ask" coming from global/project config may
        // be auto-approved.
        //   - `mandatory` marks gates the tool itself deems unskippable (e.g. a
        //     write that escapes the project root).
        //   - `detail` is passed as the pattern-match value so an agent bash
        //     rule like {"sudo *":"ask"} is correctly detected as mandated.
        const agentMandated =
          mandatory === true ||
          evaluatePermission(toolName, { global: {}, agent: agent.permission }, detail) === "ask"
        if (!agentMandated && this.deps.autoApprove?.()) return Promise.resolve(true)
        return handlers.requestApproval(toolName, detail)
      },
      report: handlers.report,
      headroom: this.deps.headroom,
      permissionFor: (toolName: string, argValue?: string): PermissionLevel =>
        evaluatePermission(
          toolName,
          { global: this.deps.globalPermissions, agent: agent.permission },
          argValue,
        ),
    }

    // Event-driven hooks (lint-on-save, pre/post tool checks, etc.). Best-effort:
    // a failing hook never breaks the turn. runCommand output and askAgent
    // prompts are surfaced to the user and fed back to the model as context.
    const fireHooks = async (event: HookEvent): Promise<void> => {
      const reg = this.deps.hooks
      if (!reg) return
      let outcomes
      try {
        outcomes = await reg.fire(event, this.deps.projectRoot)
      } catch {
        return
      }
      for (const o of outcomes) {
        if (!o.output) continue
        handlers.report(`hook ${o.hook} (${event.type})`)
        this.deps.sessions.addMessage(sessionId, {
          role: "system",
          content: `[hook:${o.hook}] ${o.output.slice(0, 2000)}`,
        })
      }
    }

    await fireHooks({ type: "promptSubmit", message: userMessage })

    while (step < maxSteps) {
      step++
      if (options.signal?.aborted) {
        handlers.report("Turn cancelled.")
        break
      }

      // Intelligent auto-compaction: if the conversation is approaching the
      // model's context window, summarize the older turns before requesting.
      await this.maybeCompact(sessionId, resolved, client, agent.prompt, handlers)

      const result = await this.completeWithFailover(
        chain,
        (model) => ({
          model,
          system: agent.prompt,
          messages: session.messages,
          tools: toolSchemas,
          temperature: agent.temperature,
          topP: agent.topP,
          signal: options.signal,
        }),
        handlers,
      )
      this.deps.sessions.addUsage(sessionId, result.usage.inputTokens, result.usage.outputTokens)

      if (result.content) {
        handlers.onText(result.content)
        finalText = result.content
      }

      // Record the assistant message (with any tool calls).
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.content,
        toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      }
      this.deps.sessions.addMessage(sessionId, assistantMessage)

      if (result.toolCalls.length === 0 || result.stopReason === "stop") {
        break
      }

      // Decide execution strategy: parallelize ONLY when every call this turn
      // is read-only (no file/shell side effects), so results can't conflict.
      const READ_ONLY = new Set(["read", "grep", "glob", "webfetch", "diagnostics", "headroom_retrieve", "skill", "memory"])
      const allReadOnly = result.toolCalls.length > 1 && result.toolCalls.every((c) => READ_ONLY.has(c.name))

      // Pre-compute per-call results (parallel when safe, else sequential),
      // applying the repeat-guard first. Results stay in original order.
      const runOne = async (call: ToolCallRequest): Promise<{ call: ToolCallRequest; output: string; change?: FileChange }> => {
        const sig = `${call.name}:${JSON.stringify(call.arguments)}`
        repeatCounts.set(sig, (repeatCounts.get(sig) ?? 0) + 1)
        if ((repeatCounts.get(sig) ?? 0) >= 3) {
          return {
            call,
            output:
              `Error: you have called ${call.name} with identical arguments 3 times. ` +
              `This is not working — STOP repeating it. Try a different approach.`,
          }
        }
        const r = await this.executeToolCall(call, allowedTools, ctx, handlers)
        return { call, output: r.output, change: r.change }
      }

      // preToolUse hooks (e.g. access checks / reminders) fire before execution.
      for (const call of result.toolCalls) await fireHooks({ type: "preToolUse", toolName: call.name })

      totalToolCalls += result.toolCalls.length
      const executed = allReadOnly
        ? await Promise.all(result.toolCalls.map(runOne))
        : await (async () => {
            const acc: { call: ToolCallRequest; output: string; change?: FileChange }[] = []
            for (const call of result.toolCalls) acc.push(await runOne(call))
            return acc
          })()

      // Process results in deterministic order: record changes, log, compress,
      // and feed each result back to the conversation by its tool_call_id.
      for (const { call, output, change } of executed) {
        if (change) {
          accumulatedChanges.push(change)
          this.deps.sessions.recordFileChange(sessionId, change)
          // File lifecycle hooks (e.g. lint/format/test on save).
          const type = change.before === null ? "fileCreated" : change.after === null ? "fileDeleted" : "fileEdited"
          await fireHooks({ type, filePath: change.path })
        }
        // postToolUse hooks fire after each tool runs.
        await fireHooks({ type: "postToolUse", toolName: call.name })
        this.deps.sessions.addToolLog(sessionId, {
          tool: call.name,
          args: JSON.stringify(call.arguments).slice(0, 200),
          status: output.startsWith("Error") || output.includes("threw") ? "error" : "ok",
          output: output.slice(0, 500),
        })
        let toolContent = output
        if (this.deps.headroom?.enabled && call.name !== "headroom_retrieve") {
          const c = this.deps.headroom.compress(output)
          if (c.compressed) {
            toolContent = c.text
            handlers.report(
              `Headroom: ${c.type} ${c.originalTokens}→${c.compressedTokens} tok ` +
                `(−${Math.round((1 - c.compressedTokens / c.originalTokens) * 100)}%)`,
            )
          }
        }

        this.deps.sessions.addMessage(sessionId, {
          role: "tool",
          content: toolContent,
          toolCallId: call.id,
        })
      }
    }

    if (accumulatedChanges.length > 0) {
      this.deps.sessions.snapshot(sessionId, accumulatedChanges)
    }

    await fireHooks({ type: "agentStop", message: finalText })

    return {
      finalText,
      steps: step,
      toolCalls: totalToolCalls,
      changes: accumulatedChanges,
    }
  }

  /**
   * Run a completion against an ordered model chain. On a token/quota
   * exhaustion error, transparently switch to the next fallback model
   * (Autochange) and retry the same request, so long tasks never stall.
   */
  private async completeWithFailover(
    chain: string[],
    makeRequest: (model: ResolvedModel) => CompletionRequest,
    handlers: LoopHandlers,
  ): Promise<CompletionResult> {
    let lastError: unknown
    for (let i = 0; i < chain.length; i++) {
      const modelString = chain[i]!
      let resolved: ResolvedModel
      try {
        resolved = this.deps.providers.resolve(modelString)
      } catch (err) {
        lastError = err
        continue
      }
      const client = this.deps.providers.client(resolved)
      try {
        const request = makeRequest(resolved)
        // Stream token-by-token when the caller wants it and the provider can.
        const result =
          handlers.onTextChunk && typeof client.completeStream === "function"
            ? await client.completeStream(request, (t) => handlers.onTextChunk!(t))
            : await client.complete(request)
        if (i > 0) handlers.report(`↪ Autochange active: running on ${modelString}.`)
        return result
      } catch (err) {
        lastError = err
        const hasNext = i < chain.length - 1
        if (isExhaustionError(err)) {
          // Remember this model is out of quota so later steps skip it.
          const retryAfter = err instanceof ProviderError ? err.retryAfter : undefined
          this.deps.router?.markExhausted(modelString, retryAfter)
          if (hasNext) {
            handlers.report(
              `⚠ ${modelString} out of tokens/quota — Autochange switching to ${chain[i + 1]}…`,
            )
            continue
          }
        }
        throw err
      }
    }
    throw lastError ?? new Error("No model available to complete the request.")
  }

  private async maybeCompact(
    sessionId: string,
    resolved: ResolvedModel,
    client: Provider,
    systemPrompt: string,
    handlers: LoopHandlers,
  ): Promise<void> {
    const settings = this.deps.compaction
    if (!settings || !settings.auto) return

    const session = this.deps.sessions.get(sessionId)
    if (!session || session.messages.length < 6) return

    const window = resolved.info.contextWindow ?? 128_000
    const decision = shouldCompact(session.messages, systemPrompt, window, settings.reserved)
    if (!decision.needed) return

    handlers.report(
      `Context near limit (~${decision.used}/${window} tok) — compacting memory…`,
    )

    const keepBudget = Math.max(2000, Math.floor(window * 0.25))
    try {
      const result = await compact(session.messages, resolved, client, keepBudget)
      if (result.summarizedCount > 0) {
        this.deps.sessions.setMessages(sessionId, result.messages)
        handlers.report(
          `✓ Compacted ${result.summarizedCount} messages into a ${result.summaryTokens}-token summary.`,
        )
      }
    } catch (err) {
      // Compaction is best-effort; never break the turn if it fails.
      handlers.report(`Compaction skipped: ${(err as Error).message}`)
    }
  }

  private async executeToolCall(
    call: ToolCallRequest,
    allowedTools: (name: string) => boolean,
    ctx: ToolContext,
    handlers: LoopHandlers,
  ): Promise<{ output: string; change?: FileChange }> {
    if (!allowedTools(call.name)) {
      const available = this.deps.tools
        .schemas(allowedTools)
        .map((s) => s.name)
        .join(", ")
      return { output: `Error: tool "${call.name}" is not available to this agent. Available tools: ${available}. Use one of those.` }
    }

    const tool = this.deps.tools.get(call.name)
    if (!tool) {
      // Auto-correction: suggest the closest tool name so the model can recover.
      const names = this.deps.tools.list().map((t) => t.name)
      const suggestion = closestName(call.name, names)
      const hint = suggestion ? ` Did you mean "${suggestion}"?` : ""
      return { output: `Error: unknown tool "${call.name}".${hint} Available tools: ${names.join(", ")}.` }
    }

    handlers.onToolStart(call.name, call.arguments)

    try {
      const result = await tool.execute(call.arguments, ctx)
      handlers.onToolEnd(call.name, result.success, result.output)

      let change: FileChange | undefined
      const meta = result.metadata
      if (meta && typeof meta["path"] === "string" && "after" in meta) {
        change = {
          path: meta["path"] as string,
          before: (meta["before"] as string | null) ?? null,
          after: (meta["after"] as string | null) ?? null,
        }
      }

      return { output: result.output, change }
    } catch (err) {
      const message = `Tool "${call.name}" threw: ${(err as Error).message}`
      handlers.onToolEnd(call.name, false, message)
      return { output: message }
    }
  }
}

/** Levenshtein-based closest match, used to suggest a tool name on typos. */
function closestName(input: string, candidates: string[]): string | null {
  let best: string | null = null
  let bestDist = Infinity
  for (const c of candidates) {
    const d = editDistance(input, c)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  // Only suggest if it's reasonably close (≤ 40% of the length).
  return best && bestDist <= Math.ceil(Math.max(input.length, best.length) * 0.4) ? best : null
}

function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost)
    }
  }
  return dp[m]![n]!
}
