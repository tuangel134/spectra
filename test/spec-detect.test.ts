import { test } from "node:test"
import assert from "node:assert/strict"

import { detectSpecIntent } from "../src/spec/detect.ts"
import {
  parseClarifyQuestions,
  parseAutoAnswers,
  formatClarifications,
  type ClarifyQuestion,
} from "../src/spec/clarify.ts"
import { requirementsPrompt } from "../src/spec/prompts.ts"

test("detectSpecIntent flags build/feature requests", () => {
  assert.equal(detectSpecIntent("build a full-stack task manager API with auth and tests").spec, true)
  assert.equal(detectSpecIntent("create a REST API for users").spec, true)
  assert.equal(detectSpecIntent("implement a dashboard application with a database").spec, true)
})

test("detectSpecIntent ignores small edits and questions", () => {
  assert.equal(detectSpecIntent("fix the typo in utils.ts").spec, false)
  assert.equal(detectSpecIntent("what is a closure in JavaScript?").spec, false)
  assert.equal(detectSpecIntent("rename getUser to fetchUser").spec, false)
  assert.equal(detectSpecIntent("explain how the loop works").spec, false)
})

test("parseClarifyQuestions parses a JSON array and tolerates markdown fences/prose", () => {
  const reply =
    "Sure, here are the questions:\n```json\n" +
    JSON.stringify([
      { question: "Which language?", options: ["TypeScript", "Python", "Go"] },
      { question: "Persistence?", options: ["SQLite", "Postgres"] },
    ]) +
    "\n```\nHope that helps!"
  const qs = parseClarifyQuestions(reply)
  assert.equal(qs.length, 2)
  assert.equal(qs[0]!.question, "Which language?")
  assert.deepEqual(qs[0]!.options, ["TypeScript", "Python", "Go"])
})

test("parseClarifyQuestions clamps to 6 questions / 5 options and drops malformed ones", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    question: `Q${i}`,
    options: Array.from({ length: 8 }, (_, j) => `o${j}`),
  }))
  const qs = parseClarifyQuestions(JSON.stringify(many))
  assert.equal(qs.length, 6)
  assert.equal(qs[0]!.options.length, 5)
  assert.deepEqual(parseClarifyQuestions("not json at all"), [])
})

test("parseAutoAnswers maps answers and falls back to the first option", () => {
  const questions: ClarifyQuestion[] = [
    { question: "Language?", options: ["TypeScript", "Go"] },
    { question: "Auth?", options: ["JWT", "Session"] },
  ]
  const reply = JSON.stringify([{ question: "Language?", answer: "Go" }]) // only one answer
  const ans = parseAutoAnswers(reply, questions)
  assert.equal(ans.length, 2)
  assert.equal(ans[0]!.answer, "Go")
  assert.equal(ans[1]!.answer, "JWT", "missing answer falls back to first option")
})

test("formatClarifications renders a block, empty when no answers", () => {
  assert.equal(formatClarifications([]), "")
  const block = formatClarifications([{ question: "Language?", answer: "TypeScript" }])
  assert.match(block, /Clarified decisions/)
  assert.match(block, /Language\? → TypeScript/)
})

test("parseClarifyQuestions extracts the array even with prose and brackets around it", () => {
  const reply =
    "Here are some [important] questions to consider [see list below]:\n" +
    JSON.stringify([{ question: "Language?", options: ["TS [strict]", "Go"] }]) +
    "\nLet me know your thoughts!"
  const qs = parseClarifyQuestions(reply)
  assert.equal(qs.length, 1)
  assert.equal(qs[0]!.question, "Language?")
  assert.deepEqual(qs[0]!.options, ["TS [strict]", "Go"])
})

test("parseClarifyQuestions handles a fenced block with trailing prose and inner brackets", () => {
  const reply =
    "```json\n" +
    JSON.stringify([{ question: "Storage [DB]?", options: ["SQLite", "Postgres"] }]) +
    "\n```\nThat's my suggestion."
  const qs = parseClarifyQuestions(reply)
  assert.equal(qs.length, 1)
  assert.equal(qs[0]!.question, "Storage [DB]?")
})

test("requirementsPrompt injects the clarifications block", () => {
  const block = formatClarifications([{ question: "DB?", answer: "Postgres" }])
  const prompt = requirementsPrompt("feature", "a notes app", block)
  assert.match(prompt, /clarified the following/)
  assert.match(prompt, /DB\? → Postgres/)
  // Without clarifications, no such block.
  assert.doesNotMatch(requirementsPrompt("feature", "a notes app"), /clarified the following/)
})
