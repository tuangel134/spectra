/**
 * Intelligent context compaction.
 *
 * As a conversation approaches a model's context window, Spectra automatically
 * summarizes the older part of the transcript into a dense, structured note —
 * preserving goals, decisions, constraints, file changes, and open tasks — while
 * keeping the most recent turns verbatim. This is Kiro-style memory management:
 * the agent keeps working across long sessions without losing the thread.
 */

import type { ChatMessage, Provider, ResolvedModel } from "../provider/types.js"

/**
 * Estimate token count for a piece of text.
 *
 * Heuristic tuned for code + prose (ported from SpecForge):
 *   - CJK characters ≈ 1 token each
 *   - words: short ≈ 1 token, long split by ~4 chars
 *   - punctuation ≈ 0.5 token
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let tokens = 0
  const re = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]|[\w]+|[^\s\w]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const piece = m[0]
    if (/[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/.test(piece)) tokens += 1
    else if (/^\w+$/.test(piece)) tokens += piece.length > 6 ? Math.ceil(piece.length / 4) : 1
    else tokens += 0.5
  }
  return Math.max(1, Math.ceil(tokens))
}

/** Estimate the total token footprint of a message list. */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const msg of messages) {
    total += estimateTokens(msg.content)
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) total += estimateTokens(JSON.stringify(tc.arguments)) + 4
    }
    total += 4 // per-message overhead
  }
  return total
}

export interface CompactionDecision {
  needed: boolean
  /** Estimated tokens currently in use (messages + system). */
  used: number
  /** The budget that triggers compaction. */
  threshold: number
  contextWindow: number
}

/**
 * Decide whether the conversation should be compacted before the next request.
 *
 * Triggers when the estimated usage exceeds a fraction of the window minus a
 * reserved buffer for the response.
 */
export function shouldCompact(
  messages: ChatMessage[],
  systemPrompt: string,
  contextWindow: number,
  reserved: number,
): CompactionDecision {
  const used = estimateMessagesTokens(messages) + estimateTokens(systemPrompt)
  // Leave room for the response (reserved) and compact a bit before the hard
  // limit so we never overflow mid-stream.
  const threshold = Math.max(2000, Math.floor(contextWindow * 0.75) - reserved)
  return { needed: used > threshold, used, threshold, contextWindow }
}

/** Split messages into the part to summarize and the recent part to keep. */
export function splitForCompaction(
  messages: ChatMessage[],
  keepTokenBudget: number,
): { toSummarize: ChatMessage[]; toKeep: ChatMessage[] } {
  // Always keep at least the last 2 messages; grow the kept window until it
  // fills the keep budget (recent context matters most).
  const toKeep: ChatMessage[] = []
  let kept = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    let cost = estimateTokens(msg.content) + 4
    // Count tool-call argument tokens too, matching estimateMessagesTokens so
    // the keep window honors the real budget on tool-heavy transcripts.
    if (msg.toolCalls) for (const tc of msg.toolCalls) cost += estimateTokens(JSON.stringify(tc.arguments)) + 4
    if (toKeep.length >= 2 && kept + cost > keepTokenBudget) break
    toKeep.unshift(msg)
    kept += cost
  }
  // Never begin the kept window with an orphaned tool result: pull in the
  // preceding assistant (which carries the matching tool_calls) so the
  // tool_call/tool_result pairing stays intact — otherwise the next provider
  // request is rejected for a tool message with no preceding tool_calls.
  let boundary = messages.length - toKeep.length
  while (boundary > 0 && toKeep[0]!.role === "tool") {
    boundary--
    toKeep.unshift(messages[boundary]!)
  }
  const toSummarize = messages.slice(0, boundary)
  return { toSummarize, toKeep }
}

const SUMMARY_SYSTEM = `You are a context compaction engine. Summarize the conversation below into a dense, structured note that lets an AI coding agent continue seamlessly. Preserve, under clear headings:

- GOAL: what the user is ultimately trying to achieve
- DECISIONS: choices made and why (architecture, libraries, naming)
- CONSTRAINTS: rules, preferences, things to avoid
- FILES: files created/modified and their purpose
- STATE: what is done, what is in progress, what remains
- OPEN QUESTIONS: anything unresolved

Be concise but complete. Omit chit-chat. Use short bullet points. This summary REPLACES the older messages, so do not lose any actionable detail.`

/** Render a transcript of messages for summarization. */
function transcript(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === "tool") return `[tool result] ${m.content.slice(0, 500)}`
      const calls = m.toolCalls?.map((c) => `${c.name}(${JSON.stringify(c.arguments).slice(0, 120)})`).join(", ")
      const prefix = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System"
      return `${prefix}: ${m.content}${calls ? `\n[tool calls: ${calls}]` : ""}`
    })
    .join("\n\n")
}

export interface CompactionResult {
  messages: ChatMessage[]
  summarizedCount: number
  summaryTokens: number
}

/**
 * Perform intelligent compaction: summarize the older messages via the model
 * and return a new message list: [summary, ...recent].
 */
export async function compact(
  messages: ChatMessage[],
  model: ResolvedModel,
  client: Provider,
  keepTokenBudget: number,
): Promise<CompactionResult> {
  const { toSummarize, toKeep } = splitForCompaction(messages, keepTokenBudget)
  if (toSummarize.length === 0) {
    return { messages, summarizedCount: 0, summaryTokens: 0 }
  }

  const result = await client.complete({
    model,
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: transcript(toSummarize) }],
    tools: [],
    maxTokens: 2000,
  })

  const summaryText = result.content.trim() || "(summary unavailable)"
  const summaryMessage: ChatMessage = {
    role: "system",
    content: `[Earlier conversation compacted to save context]\n\n${summaryText}`,
  }

  return {
    messages: [summaryMessage, ...toKeep],
    summarizedCount: toSummarize.length,
    summaryTokens: estimateTokens(summaryText),
  }
}
