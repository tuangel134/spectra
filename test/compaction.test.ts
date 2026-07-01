import { test } from "node:test"
import assert from "node:assert/strict"

import {
  estimateTokens,
  estimateMessagesTokens,
  shouldCompact,
  splitForCompaction,
  compact,
} from "../src/session/compaction.ts"
import type { ChatMessage, Provider, ResolvedModel, CompletionResult } from "../src/provider/types.ts"

test("estimateTokens scales with content", () => {
  assert.equal(estimateTokens(""), 0)
  assert.ok(estimateTokens("hello world") >= 2)
  // Longer text → more tokens.
  assert.ok(estimateTokens("a".repeat(100)) > estimateTokens("a".repeat(10)))
})

function msgs(n: number, size = 200): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: "x".repeat(size),
  })) as ChatMessage[]
}

test("shouldCompact triggers when usage exceeds the windowed threshold", () => {
  const small = shouldCompact(msgs(2, 50), "sys", 100_000, 10_000)
  assert.equal(small.needed, false)

  // A tiny window forces compaction.
  const big = shouldCompact(msgs(40, 500), "sys", 8_000, 2_000)
  assert.equal(big.needed, true)
  assert.ok(big.used > big.threshold)
})

test("splitForCompaction keeps recent messages within budget and at least 2", () => {
  const messages = msgs(20, 100)
  const { toSummarize, toKeep } = splitForCompaction(messages, 600)
  assert.ok(toKeep.length >= 2)
  assert.equal(toSummarize.length + toKeep.length, messages.length)
  // Kept messages are the most recent ones.
  assert.equal(toKeep[toKeep.length - 1], messages[messages.length - 1])
})

// A fake provider that returns a canned summary for the compaction call.
const fakeProvider: Provider = {
  family: "openai-compatible",
  async complete(): Promise<CompletionResult> {
    return {
      content: "GOAL: build a thing\nDECISIONS: use TS\nSTATE: in progress",
      toolCalls: [],
      stopReason: "stop",
      usage: { inputTokens: 100, outputTokens: 20 },
    }
  },
}

const fakeModel = { info: { contextWindow: 8000 } } as ResolvedModel

test("compact replaces old messages with a summary and keeps recent ones", async () => {
  const messages = msgs(20, 300)
  const result = await compact(messages, fakeModel, fakeProvider, 1500)
  assert.ok(result.summarizedCount > 0)
  // First message is the summary system note.
  assert.equal(result.messages[0]!.role, "system")
  assert.ok(result.messages[0]!.content.includes("compacted"))
  assert.ok(result.messages[0]!.content.includes("GOAL"))
  // Result is shorter than the original.
  assert.ok(result.messages.length < messages.length)
  // The most recent message survived verbatim.
  assert.equal(result.messages[result.messages.length - 1]!.content, messages[messages.length - 1]!.content)
})

test("compact is a no-op when there is nothing old to summarize", async () => {
  const messages = msgs(2, 50)
  const result = await compact(messages, fakeModel, fakeProvider, 100000)
  assert.equal(result.summarizedCount, 0)
  assert.equal(result.messages, messages)
})

test("splitForCompaction never starts the kept window with an orphaned tool result", () => {
  // Build: [user, assistant(tool_calls), tool result, user, assistant]. A tight
  // budget would keep from the tool result, orphaning it from its tool_calls.
  const messages: ChatMessage[] = [
    { role: "user", content: "x".repeat(400) },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read", arguments: { path: "a" } }] },
    { role: "tool", content: "y".repeat(400), toolCallId: "c1" },
    { role: "user", content: "z".repeat(50) },
    { role: "assistant", content: "done" },
  ]
  const { toKeep } = splitForCompaction(messages, 120)
  assert.notEqual(toKeep[0]!.role, "tool", "kept window must not begin with a tool result")
  // If a tool result is kept, its assistant tool_calls must be kept before it.
  const toolIdx = toKeep.findIndex((m) => m.role === "tool")
  if (toolIdx >= 0) {
    assert.ok(
      toKeep.slice(0, toolIdx).some((m) => m.role === "assistant" && (m.toolCalls?.length ?? 0) > 0),
      "a kept tool result must be preceded by its assistant tool_calls",
    )
  }
})
