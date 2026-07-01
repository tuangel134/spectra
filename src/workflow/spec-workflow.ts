/**
 * Spec workflow.
 *
 * Orchestrates the full spec-driven flow: generate requirements, design, and
 * tasks using the spec agent, write them to disk, then optionally execute the
 * tasks wave by wave.
 */

import { stdout } from "node:process"

import type { Runtime } from "../runtime.js"
import type { LoopHandlers } from "../session/loop.js"
import type { Task, TaskStatus } from "../spec/types.js"
import { requirementsPrompt, designPrompt, tasksPrompt } from "../spec/prompts.js"
import { detectVerifyCommands, runVerification } from "../autorun/verify.js"
import {
  clarifyPrompt,
  autoAnswerPrompt,
  parseClarifyQuestions,
  parseAutoAnswers,
  formatClarifications,
  type ClarifyQuestion,
  type Clarification,
} from "../spec/clarify.js"
import { color } from "../util/logger.js"

/**
 * Ask the model for a short set of multiple-choice clarifying questions for a
 * build request. Uses the small/cheap model and never throws (returns [] on
 * any failure, so callers can fall back to a no-questions flow).
 */
export async function generateClarifyingQuestions(
  rt: Runtime,
  description: string,
): Promise<ClarifyQuestion[]> {
  try {
    const modelString = rt.config.config.small_model ?? rt.config.config.model
    const resolved = rt.providers.resolve(modelString)
    const client = rt.providers.client(resolved)
    const res = await client.complete({
      model: resolved,
      system: "You produce concise, decision-focused clarifying questions as strict JSON.",
      messages: [{ role: "user", content: clarifyPrompt(description) }],
      tools: [],
      maxTokens: 900,
    })
    return parseClarifyQuestions(res.content)
  } catch {
    return []
  }
}

/** Let the model answer its own clarifying questions (auto mode). */
export async function autoAnswerQuestions(
  rt: Runtime,
  description: string,
  questions: ClarifyQuestion[],
): Promise<Clarification[]> {
  if (questions.length === 0) return []
  try {
    const modelString = rt.config.config.small_model ?? rt.config.config.model
    const resolved = rt.providers.resolve(modelString)
    const client = rt.providers.client(resolved)
    const res = await client.complete({
      model: resolved,
      system: "You choose the best production-grade defaults and reply as strict JSON.",
      messages: [{ role: "user", content: autoAnswerPrompt(description, questions) }],
      tools: [],
      maxTokens: 900,
    })
    return parseAutoAnswers(res.content, questions)
  } catch {
    // Fall back to the first suggested option for each question.
    return parseAutoAnswers("", questions)
  }
}

/**
 * Use the spec agent to generate a single document from a prompt.
 * Runs an isolated session so generation does not pollute the main chat.
 */
async function generateDocument(
  rt: Runtime,
  prompt: string,
  handlers: LoopHandlers,
): Promise<string> {
  const specAgent = rt.agents.get("spec") ?? rt.agents.current_()
  const session = rt.sessions.create(specAgent.id, specAgent.model ?? rt.config.config.model, undefined, false)

  const result = await rt.loop.run({
    sessionId: session.id,
    agent: { ...specAgent, allowedTools: [] }, // pure text generation, no tools
    userMessage: prompt,
    handlers: { ...handlers, onText: () => {}, onTextChunk: undefined }, // suppress streaming; we capture the return
  })

  return result.finalText
}

export interface SpecWorkflowResult {
  specId: string
  tasks: Task[]
}

export async function runSpecWorkflow(
  rt: Runtime,
  description: string,
  handlers: LoopHandlers,
  clarifications: Clarification[] = [],
): Promise<SpecWorkflowResult> {
  const meta = rt.specs.create(description, "feature")
  stdout.write(color.cyan(`\n⚡ Spec created: ${meta.id}\n`))

  const clarifyBlock = formatClarifications(clarifications)
  if (clarifyBlock) {
    stdout.write(color.gray(`  Using ${clarifications.length} clarified decision(s).\n`))
  }

  // Phase 1: Requirements
  stdout.write(color.gray("  Generating requirements...\n"))
  const requirements = await generateDocument(rt, requirementsPrompt("feature", description, clarifyBlock), handlers)
  rt.specs.writeRequirements(meta.id, requirements)
  stdout.write(color.green("  ✓ requirements.md\n"))

  // Phase 2: Design
  stdout.write(color.gray("  Generating design...\n"))
  const design = await generateDocument(rt, designPrompt(requirements), handlers)
  rt.specs.writeDesign(meta.id, design)
  stdout.write(color.green("  ✓ design.md\n"))

  // Phase 3: Tasks
  stdout.write(color.gray("  Generating tasks...\n"))
  const tasksMd = await generateDocument(rt, tasksPrompt(requirements, design), handlers)
  rt.specs.writeTasks(meta.id, tasksMd)
  const tasks = rt.specs.loadTasks(meta.id)
  stdout.write(color.green(`  ✓ tasks.md (${tasks.length} tasks)\n`))

  // Show the execution plan.
  const { waves, hasCycles } = rt.specs.plan(tasks)
  if (hasCycles) {
    stdout.write(color.red("  ⚠ Task graph has a circular dependency.\n"))
  } else {
    stdout.write(color.gray(`  Execution plan: ${waves.length} wave(s)\n`))
    for (const wave of waves) {
      const ids = wave.tasks.map((t) => `#${t.id}`).join(", ")
      stdout.write(color.gray(`    Wave ${wave.number}: ${ids}\n`))
    }
  }

  stdout.write(
    color.gray(`\n  Spec written to ${rt.specs.specDir(meta.id)}\n  Run "/run ${meta.id}" to execute.\n\n`),
  )

  return { specId: meta.id, tasks }
}

/**
 * Execute the tasks of a spec, using the build agent to implement each task.
 */
export async function runSpecExecution(
  rt: Runtime,
  specId: string,
  handlers: LoopHandlers,
): Promise<void> {
  const tasksMd = rt.specs.readDocument(specId, "tasks")
  if (!tasksMd) {
    stdout.write(color.red(`No tasks.md found for spec ${specId}.\n`))
    return
  }

  const meta = rt.specs.readMeta(specId)
  const title = meta?.title ?? specId

  const tasks = rt.specs.loadTasks(specId)
  const buildAgent = rt.agents.get("build") ?? rt.agents.current_()

  const requirements = rt.specs.readDocument(specId, "requirements") ?? ""
  const design = rt.specs.readDocument(specId, "design") ?? ""

  const onStatusChange = (taskId: number, status: TaskStatus): void => {
    const icon =
      status === "completed"
        ? color.green("✓")
        : status === "failed"
          ? color.red("✗")
          : status === "in_progress"
            ? color.cyan("▶")
            : status === "skipped"
              ? color.yellow("⊘")
              : "·"
    stdout.write(`  ${icon} Task ${taskId} ${status}\n`)
  }

  const runner = {
    async run(task: Task): Promise<{ success: boolean; error?: string }> {
      await rt.hooks.fire({ type: "preTaskExecution", taskId: task.id, taskTitle: task.title }, rt.config.projectRoot).catch(() => {})
      const session = rt.sessions.create(buildAgent.id, buildAgent.model ?? rt.config.config.model, undefined, false)
      const prompt = [
        `Implement this task as part of a larger spec.`,
        ``,
        `## Task ${task.id}: ${task.title}`,
        task.description ? `\n${task.description}` : "",
        `\nFiles likely involved: ${task.files.join(", ") || "(determine yourself)"}`,
        `Validation: ${task.validation || "ensure the build/tests pass"}`,
        ``,
        `## Context`,
        `Requirements:\n${requirements.slice(0, 2000)}`,
        `\nDesign:\n${design.slice(0, 2000)}`,
        ``,
        `Make the necessary changes using your tools, then verify.`,
      ].join("\n")

      const result = await rt.loop.run({
        sessionId: session.id,
        agent: buildAgent,
        userMessage: prompt,
        handlers,
      })

      await rt.hooks.fire({ type: "postTaskExecution", taskId: task.id, taskTitle: task.title }, rt.config.projectRoot).catch(() => {})
      // A task "succeeds" if it ran without throwing; real validation is the
      // whole-project build/test gate run at the end of the spec.
      return { success: result.steps > 0 }
    },
  }

  stdout.write(color.cyan(`\n⚡ Executing spec ${specId}...\n`))
  const report = await rt.specs.execute(specId, title, tasks, runner, onStatusChange)

  stdout.write(
    color.bold(
      `\n  Done: ${report.completed} completed, ${report.failed} failed, ${report.skipped} skipped (${Math.round(report.durationMs / 1000)}s)\n`,
    ),
  )
  for (const err of report.errors) {
    stdout.write(color.red(`  Task ${err.taskId} (${err.title}): ${err.error}\n`))
  }

  // Final validation gate: prove the delivered project actually builds/tests
  // green, instead of trusting that each task "did something".
  const commands = detectVerifyCommands(rt.config.projectRoot)
  if (commands.length > 0) {
    stdout.write(color.gray(`\n  Validating: ${commands.join(", ")}\n`))
    const verify = await runVerification(commands, rt.config.projectRoot)
    if (verify.ok) {
      stdout.write(color.green(`  ✓ Validation passed (build/tests green).\n`))
    } else {
      const failed = verify.results.find((r) => !r.ok)
      stdout.write(color.red(`  ✗ Validation FAILED: ${failed?.command}\n`))
      stdout.write(color.gray(`${(failed?.output ?? "").slice(-800)}\n`))
      stdout.write(color.yellow(`  The spec ran but the project does not pass verification — review the failures above.\n`))
    }
  }
}
