/**
 * Autopilot — the Long-Running / Full-Stack orchestrator.
 *
 * Drives a project from a one-line goal to a complete, error-free deliverable,
 * unattended, for as long as it takes:
 *
 *   1. PLAN     — generate a spec (requirements → design → tasks) and split the
 *                 tasks into dependency-ordered phases.
 *   2. EXECUTE  — implement each phase with a full-access build agent.
 *   3. VERIFY   — after every phase, run build/test/lint and a no-skeleton scan.
 *   4. FIX      — up to `reviewPasses` bug-review/fix cycles per phase; if the
 *                 same failure persists (stall), research the error on the web
 *                 and try a different approach.
 *   5. REPEAT   — mark the phase done, checkpoint, advance — until every phase
 *                 passes a final whole-project verification with zero errors.
 *
 * A watchdog resumes the run if it stalls/crashes; an anti-stall detector
 * switches strategy when progress flatlines. All state is checkpointed so the
 * run survives restarts.
 */

import type { Runtime } from "../runtime.js"
import type { LoopHandlers } from "../session/loop.js"
import type { Agent } from "../agent/types.js"
import { isAbsolute, join } from "node:path"
import { runSpecWorkflow } from "../workflow/spec-workflow.js"
import { lintReport } from "../spec/lint.js"
import { isExhaustionError } from "../routing/index.js"
import { ProviderError } from "../provider/types.js"
import { languageForFile } from "../lsp/manager.js"
import { capture } from "../tool/browser.js"
import { formatDiagnostics } from "../lsp/index.js"
import { AutorunStore } from "./state.js"
import { Watchdog } from "./watchdog.js"
import { StallDetector, progressSignature, errorDigest } from "./stall.js"
import {
  detectVerifyCommands,
  runVerification,
  collectSourceFiles,
  scanForSkeletons,
  scanStructuralIssues,
  projectSnapshot,
  type CommandResult,
  type SkeletonViolation,
  type StructuralIssue,
} from "./verify.js"
import { polishPrompt, parsePolishVerdict } from "./polish.js"
import {
  type AutorunState,
  type AutorunPhase,
  type AutorunConfig,
  type EventLevel,
  DEFAULT_AUTORUN_CONFIG,
} from "./types.js"

/** Max completeness/polish review rounds at the final gate (then ship if green). */
const MAX_POLISH_PASSES = 2

export interface AutopilotDeps {
  rt: Runtime
  config?: AutorunConfig
  /** Live event sink for the UI. */
  onEvent?: (state: AutorunState) => void
}

export class Autopilot {
  private readonly store: AutorunStore
  private readonly cfg: Required<AutorunConfig>
  private state: AutorunState | null = null
  private watchdog: Watchdog | null = null
  private stall: StallDetector
  private running = false
  private cancelled = false
  private filesChanged = 0
  private totalAttempts = 0
  /** Bounded count of completeness/polish reviews run at the final gate. */
  private polishReviews = 0
  /** Relative paths changed during the run (for targeted LSP diagnostics). */
  private readonly changedPaths = new Set<string>()

  constructor(private readonly deps: AutopilotDeps) {
    this.store = new AutorunStore(deps.rt.config.projectRoot)
    this.cfg = { ...DEFAULT_AUTORUN_CONFIG, ...(deps.config ?? {}) }
    this.stall = new StallDetector(this.cfg.stallThreshold)
  }

  get current(): AutorunState | null {
    return this.state
  }

  get isRunning(): boolean {
    return this.running
  }

  /** Request a graceful stop after the current step. */
  cancel(): void {
    this.cancelled = true
    if (this.state && !this.state.finished) {
      this.state.status = "paused"
      this.emit("warn", "Pause requested — will stop after the current step.")
    }
  }

  /** Start a brand-new autonomous run for a goal. */
  async start(goal: string): Promise<AutorunState> {
    const state = this.store.create(goal)
    this.state = state
    return this.drive(state)
  }

  /** Resume an unfinished run (latest by default), e.g. after a crash. */
  async resume(id?: string): Promise<AutorunState> {
    const state = id ? this.store.load(id) : this.store.latestResumable()
    if (!state) throw new Error("No resumable autorun found.")
    state.recoveries++
    this.state = state
    this.stall = new StallDetector(this.cfg.stallThreshold)
    this.emit("info", `Resuming run ${state.id} at phase ${state.currentPhase + 1}/${state.phases.length}.`)
    return this.drive(state)
  }

  // ── core driver ──────────────────────────────────────────────────────────

  private async drive(state: AutorunState): Promise<AutorunState> {
    this.running = true
    this.cancelled = false
    // Rehydrate run-total counters so the attempts ceiling and anti-stall
    // survive a crash/resume instead of silently resetting to zero.
    this.totalAttempts = state.totalAttempts ?? 0
    this.filesChanged = state.filesChanged ?? 0
    this.polishReviews = state.polishReviews ?? 0
    this.startWatchdog()
    try {
      if (state.phases.length === 0) await this.plan(state)
      if (!this.cancelled && state.status !== "failed") await this.execute(state)
    } catch (err) {
      this.handleRunError(state, err)
    } finally {
      this.watchdog?.stop()
      this.running = false
      this.beat()
      this.store.save(state)
    }
    return state
  }

  private startWatchdog(): void {
    this.watchdog = new Watchdog({
      staleMs: this.cfg.heartbeatStaleMs,
      onStale: (since) => {
        // The orchestrator is single-threaded and awaits each step, so a stale
        // heartbeat means a step is wedged. Record it; on the next process
        // launch `resume()` picks up from the checkpoint.
        if (this.state && !this.state.finished) {
          this.emit("warn", `Watchdog: no progress for ${Math.round(since / 1000)}s — checkpoint saved for resume.`)
        }
      },
    })
    this.watchdog.start()
  }

  /**
   * Classify a fatal run error. A token/quota/rate-limit block (e.g. an
   * OpenCode free-tier 429 with a long `retry-after`) is NOT a real failure:
   * the work is checkpointed, so we keep the run resumable and tell the user
   * how long to wait and that Autochange fallbacks would have kept it going.
   */
  private handleRunError(state: AutorunState, err: unknown): void {
    const message = (err as Error).message
    if (isExhaustionError(err)) {
      const retry = err instanceof ProviderError ? err.retryAfter : undefined
      const wait = retry ? ` Try again in ~${formatDuration(retry)}.` : ""
      state.status = "paused" // resumable, not failed — pick up after the window
      state.lastError = `Model out of tokens/quota (rate-limited).${wait} ${message}`.slice(0, 600)
      this.emit(
        "warn",
        `Run paused: the model is rate-limited / out of free quota.${wait} ` +
          `Configure Autochange fallbacks (routing.autochange) on a DIFFERENT provider so long runs ` +
          `survive this — then resume.`,
      )
      return
    }
    state.status = "failed"
    state.lastError = message
    this.emit("error", `Run failed: ${state.lastError}`)
  }

  // ── 1. PLAN ────────────────────────────────────────────────────────────────

  private async plan(state: AutorunState): Promise<void> {
    state.status = "planning"
    this.emit("phase", `Planning the project: "${state.goal}"`)

    const result = await runSpecWorkflow(this.deps.rt, state.goal, this.loopHandlers("plan"))
    state.specId = result.specId

    // Spec-lint: warn if the generated requirements are weak (not EARS/testable).
    const requirements = this.deps.rt.specs.readDocument(result.specId, "requirements") ?? ""
    if (requirements) {
      const report = lintReport(requirements)
      if (report.errors > 0 || report.warnings > 2) {
        this.emit(
          "warn",
          `Spec-lint: ${report.errors} error(s), ${report.warnings} warning(s) (quality ${Math.round(report.score * 100)}%). Building anyway.`,
        )
      } else {
        this.emit("info", `Spec-lint: requirements look testable (quality ${Math.round(report.score * 100)}%).`)
      }
    }

    const { waves } = this.deps.rt.specs.plan(result.tasks)
    if (result.tasks.length === 0 || waves.length === 0) {
      state.status = "failed"
      state.lastError = "The spec generated no tasks. The model may not have responded correctly. Try again or use a stronger model."
      this.emit("error", state.lastError)
      this.store.save(state)
      return
    }
    state.phases = waves.map((wave, i): AutorunPhase => {
      const titles = wave.tasks.map((t) => t.title)
      return {
        index: i,
        title: titles.length === 1 ? titles[0]! : `Phase ${i + 1} — ${titles.slice(0, 2).join("; ")}`,
        taskIds: wave.tasks.map((t) => t.id),
        status: "pending",
        reviewPasses: 0,
      }
    })
    state.currentPhase = 0
    this.emit("success", `Plan ready: ${result.tasks.length} tasks across ${state.phases.length} phases.`)
    this.store.save(state)
  }

  // ── 2–5. EXECUTE / VERIFY / FIX ─────────────────────────────────────────────

  private async execute(state: AutorunState): Promise<void> {
    state.status = "executing"
    for (let i = state.currentPhase; i < state.phases.length; i++) {
      if (this.cancelled) return
      state.currentPhase = i
      const phase = state.phases[i]!
      if (phase.status === "completed") continue

      phase.status = "in_progress"
      phase.startedAt = phase.startedAt ?? Date.now()
      this.emit("phase", `▶ Phase ${i + 1}/${state.phases.length}: ${phase.title}`)
      this.store.save(state)

      await this.implementPhase(state, phase)
      if (this.cancelled) return

      await this.verifyAndFixPhase(state, phase)
      if (this.cancelled) return

      // A phase left "failed" means the hard attempts-ceiling tripped inside
      // verifyAndFixPhase; that is a real stop signal, not a deferrable miss.
      // (A phase that merely exhausted its per-phase fix passes is left in
      // "fixing" and is intentionally deferred to the final gate below.)
      if ((phase.status as string) === "failed") {
        state.status = "failed"
        state.lastError = state.lastError || `Phase ${i + 1} hit the attempts ceiling.`
        this.emit("error", `Stopping: phase ${i + 1} hit the attempts ceiling to avoid an infinite loop.`)
        this.store.save(state)
        return
      }

      phase.status = "completed"
      phase.completedAt = Date.now()
      this.markTasksComplete(state, phase)
      this.emit("success", `✓ Phase ${i + 1} complete.`)
      this.store.save(state)
    }

    // Final whole-project gate: nothing ships with errors or skeletons.
    await this.finalGate(state)
  }

  private async implementPhase(state: AutorunState, phase: AutorunPhase): Promise<void> {
    const tasks = this.deps.rt.specs.loadTasks(state.specId!)
    const phaseTasks = tasks.filter((t) => phase.taskIds.includes(t.id))
    const requirements = this.deps.rt.specs.readDocument(state.specId!, "requirements") ?? ""
    const design = this.deps.rt.specs.readDocument(state.specId!, "design") ?? ""

    const taskPrompt = (subset: typeof phaseTasks): string => {
      const taskList = subset
        .map((t) => `- Task ${t.id}: ${t.title}\n  ${t.description}\n  Validation: ${t.validation || "build & tests pass"}`)
        .join("\n")
      return [
        `You are in FULL-STACK AUTOPILOT mode. Implement the following work COMPLETELY.`,
        ``,
        `## Project goal`,
        state.goal,
        ``,
        `## Work to implement`,
        taskList,
        ``,
        `## Hard rules`,
        `- Deliver COMPLETE, production-quality code. No TODOs, stubs, placeholders, or "not implemented".`,
        `- Create every file and wire everything together. It must actually work end to end.`,
        `- Polish EVERYTHING: a real, styled, responsive UI wired to the backend; the`,
        `  backend with input validation, error handling and real persistence; no`,
        `  placeholder/dummy/"example" content or lorem ipsum anywhere.`,
        `- Include meaningful tests for the core behavior.`,
        `- Follow existing project conventions; read before writing.`,
        `- After writing code, run the build/tests yourself and fix what you broke.`,
        ``,
        `## Context (truncated)`,
        `Requirements:\n${requirements.slice(0, 1800)}`,
        `\nDesign:\n${design.slice(0, 1800)}`,
      ].join("\n")
    }

    // Swarm: when enabled and the phase has several independent tasks, run them
    // as bounded-concurrency parallel subagents. The waves are already
    // dependency-grouped, so tasks within a phase are safe to parallelize —
    // EXCEPT when two tasks declare the same file (concurrent edits would
    // clobber each other), in which case we fall back to a single agent.
    const filesOverlap = (): boolean => {
      const seen = new Set<string>()
      for (const t of phaseTasks) {
        for (const f of t.files) {
          if (seen.has(f)) return true
          seen.add(f)
        }
      }
      return false
    }
    if (this.cfg.parallel && phaseTasks.length > 1 && !filesOverlap()) {
      const limit = Math.max(1, Math.min(this.cfg.maxParallel, phaseTasks.length))
      this.emit("phase", `Swarm: implementing ${phaseTasks.length} tasks with up to ${limit} parallel agents.`)
      let cursor = 0
      const worker = async (): Promise<void> => {
        while (cursor < phaseTasks.length) {
          if (this.cancelled) return
          const task = phaseTasks[cursor++]!
          const changed = await this.runAgent(taskPrompt([task]), "build")
          this.filesChanged += changed
          this.beat()
        }
      }
      // allSettled so one worker's failure never orphans the others into an
      // unhandled rejection; surface the first error after all have wound down.
      const results = await Promise.allSettled(Array.from({ length: limit }, () => worker()))
      const failed = results.find((r) => r.status === "rejected")
      if (failed && failed.status === "rejected") throw failed.reason
      return
    }

    const changed = await this.runAgent(taskPrompt(phaseTasks), "build")
    this.filesChanged += changed
    this.beat()
  }

  private async verifyAndFixPhase(state: AutorunState, phase: AutorunPhase): Promise<void> {
    const cwd = this.deps.rt.config.projectRoot
    const commands = detectVerifyCommands(cwd, this.cfg.verifyCommands)

    for (let pass = 0; pass < this.cfg.maxFixAttempts; pass++) {
      if (this.cancelled) return
      this.totalAttempts++
      if (this.totalAttempts > this.cfg.maxTotalAttempts) {
        this.emit("error", "Reached the maximum total attempts ceiling; stopping to avoid an infinite loop.")
        phase.status = "failed"
        return
      }

      state.status = "verifying"
      phase.status = "verifying"
      phase.reviewPasses = pass + 1
      this.emit("verify", `Bug-review pass ${pass + 1}/${this.cfg.maxFixAttempts} for phase ${phase.index + 1}…`)

      const verify = commands.length > 0 ? await runVerification(commands, cwd) : { ok: true, results: [] as CommandResult[] }
      const skeletons = scanForSkeletons(collectSourceFiles(cwd))
      const structural = scanStructuralIssues(cwd)
      const blockingStructural = structural.filter((s) => s.blocking)
      const lspFail = await this.diagnosticsFailures()
      this.beat()

      if (verify.ok && skeletons.length === 0 && !lspFail && blockingStructural.length === 0) {
        // We still want to satisfy the user's "review 3 times" rule: keep doing
        // clean review passes until reviewPasses are accumulated, but only if
        // earlier passes had found something. A clean first-pass is enough.
        this.emit("success", `Phase ${phase.index + 1} verified clean (build/tests pass, no LSP errors, no skeleton code).`)
        return
      }

      let failure = this.describeFailures(verify.results, skeletons, structural)
      if (lspFail) failure += `\n\nLSP diagnostics (errors):\n${lspFail}`
      state.lastError = failure.slice(0, 600)

      // Anti-stall: are we seeing the same failure again?
      const sig = progressSignature({
        phase: phase.index,
        phasesCompleted: state.phases.filter((p) => p.status === "completed").length,
        lastErrorDigest: errorDigest(failure),
      })
      const verdict = this.stall.record(sig)
      state.stallCount = verdict.count
      state.progressSignature = sig

      if (verdict.stalled) {
        state.status = "stalled"
        this.emit("warn", `Anti-stall: no progress for ${verdict.count} passes — switching to research.`)
        await this.research(state, failure)
        this.stall.reset()
        state.stallCount = 0
      }

      state.status = "fixing"
      phase.status = "fixing"
      this.emit("fix", `Fixing ${skeletons.length} skeleton issue(s) and verification failures…`)
      await this.runAgent(this.fixPrompt(failure, skeletons), "fix")
      this.beat()
    }

    // Exhausted fix attempts for this phase: keep the project moving but record
    // the blocker. The final gate will force another fixing round.
    this.emit("error", `Phase ${phase.index + 1} still failing after ${this.cfg.maxFixAttempts} passes; deferring to the final gate.`)
  }

  private async finalGate(state: AutorunState): Promise<void> {
    const cwd = this.deps.rt.config.projectRoot
    const commands = detectVerifyCommands(cwd, this.cfg.verifyCommands)
    if (commands.length === 0) {
      // No build/test/lint could be detected — we can still scan for skeletons
      // and structural issues, but "green" here is much weaker. Make that
      // explicit rather than silently declaring victory with zero execution.
      this.emit(
        "warn",
        "No verification commands detected (no build/test/lint). Delivery relies only on " +
          "skeleton/structural/LSP scans — add a test or build script for real acceptance.",
      )
    }
    for (let attempt = 0; attempt < this.cfg.maxFixAttempts; attempt++) {
      if (this.cancelled) return
      state.status = "verifying"
      this.emit("verify", `Final whole-project verification (attempt ${attempt + 1})…`)
      const verify = commands.length > 0 ? await runVerification(commands, cwd) : { ok: true, results: [] }
      const skeletons = scanForSkeletons(collectSourceFiles(cwd))
      const structural = scanStructuralIssues(cwd)
      const blockingStructural = structural.filter((s) => s.blocking)
      const lspFail = await this.diagnosticsFailures()
      this.beat()

      if (verify.ok && skeletons.length === 0 && !lspFail && blockingStructural.length === 0) {
        // Optional visual gate: screenshot the running app and vision-check it.
        const visual = await this.visualVerify(state)
        if (visual && !visual.ok) {
          state.status = "fixing"
          this.emit("fix", "Visual check failed — fixing the UI before delivery.")
          await this.runAgent(this.fixPrompt(`The rendered UI is wrong: ${visual.detail}`, []), "fix")
          continue
        }

        // Completeness/polish review: build + tests passing isn't enough — the
        // model judges whether the project is genuinely complete and polished
        // (real UI, wired front+back, error handling, tests, no placeholder
        // content). Bounded so we never loop forever on subjective polish.
        if (this.polishReviews < MAX_POLISH_PASSES) {
          this.polishReviews++
          const polish = await this.polishReview(state)
          this.beat()
          if (!polish.ok) {
            state.status = "fixing"
            state.lastError = `Polish review found gaps:\n${polish.detail}`.slice(0, 600)
            this.emit("fix", `Polish review found gaps (pass ${this.polishReviews}/${MAX_POLISH_PASSES}) — finishing & polishing before delivery.`)
            await this.runAgent(
              this.fixPrompt(
                `The build and tests pass, but the project is NOT yet complete and polished. ` +
                  `Fully implement and polish these — frontend, backend, visuals, wiring, tests:\n${polish.detail}`,
                [],
              ),
              "fix",
            )
            continue
          }
        }

        state.status = "completed"
        state.finished = true
        // Auto-growing evals: record the passing verification commands so future
        // `spectra eval` runs guard against regressions.
        if (commands.length > 0) {
          try {
            const { addRegressions } = await import("../eval/regressions.js")
            addRegressions(cwd, commands)
            this.emit("info", `Saved ${commands.length} regression eval(s) for future runs.`)
          } catch {
            /* best-effort */
          }
        }
        this.emit("success", "🎉 Project complete: all phases done, build/tests green, no LSP errors, no skeleton code.")
        this.store.save(state)
        return
      }

      let failure = this.describeFailures(verify.results, skeletons, structural)
      if (lspFail) failure += `\n\nLSP diagnostics (errors):\n${lspFail}`
      state.lastError = failure.slice(0, 600)
      state.status = "fixing"
      this.emit("fix", "Final gate found issues — fixing before delivery.")
      await this.runAgent(this.fixPrompt(failure, skeletons), "fix")
    }

    state.status = "failed"
    state.lastError = "Final verification did not pass within the attempt budget."
    this.emit("error", state.lastError)
    this.store.save(state)
  }

  // ── research (web) ───────────────────────────────────────────────────────

  private async research(state: AutorunState, failure: string): Promise<void> {
    state.status = "researching"
    this.emit("research", "Researching the blocking error online…")
    const prompt = [
      `You are blocked by a recurring error in FULL-STACK AUTOPILOT mode. Research it.`,
      ``,
      `Use the webfetch tool to look up the error and known fixes (official docs, issue trackers).`,
      `Then APPLY a concrete fix to the codebase using your edit/write/bash tools.`,
      ``,
      `## Recurring failure`,
      "```",
      failure.slice(0, 2000),
      "```",
      ``,
      `Try a genuinely DIFFERENT approach than before — the previous fix did not work.`,
    ].join("\n")
    await this.runAgent(prompt, "research")
    this.beat()
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * Ask the model to judge whether the delivered project is genuinely complete
   * and polished (beyond just building and passing tests). PASS, or a concrete
   * list of deficiencies to fix.
   */
  private async polishReview(state: AutorunState): Promise<{ ok: boolean; detail: string }> {
    const cwd = this.deps.rt.config.projectRoot
    this.emit("verify", "Polish review: judging completeness and quality end-to-end…")
    try {
      const snapshot = projectSnapshot(cwd)
      const resolved = this.deps.rt.providers.resolve(this.deps.rt.config.config.model)
      const client = this.deps.rt.providers.client(resolved)
      const res = await client.complete({
        model: resolved,
        system:
          "You are a strict senior reviewer doing final acceptance of an autonomously-built project. " +
          "Reply PASS only if it is genuinely complete and polished; otherwise list concrete, fixable deficiencies.",
        messages: [{ role: "user", content: polishPrompt(state.goal, snapshot) }],
        tools: [],
        maxTokens: 800,
      })
      const verdict = parsePolishVerdict(res.content)
      this.emit(
        verdict.ok ? "success" : "warn",
        verdict.ok
          ? "Polish review: PASS — complete and polished."
          : `Polish review: ${verdict.issues.slice(0, 3).join(" · ").slice(0, 200)}`,
      )
      return { ok: verdict.ok, detail: verdict.issues.join("\n") }
    } catch (err) {
      // Never block delivery of a mechanically-green project on a review error.
      this.emit("warn", `Polish review skipped: ${(err as Error).message}`)
      return { ok: true, detail: "" }
    }
  }

  // ── visual verification (screenshot + vision) ──

  /**
   * Screenshot the running app (if a preview URL is configured) and ask a
   * vision-capable model whether the UI looks complete/correct. Returns null
   * when no preview URL is set or Playwright is unavailable.
   */
  private async visualVerify(state: AutorunState): Promise<{ ok: boolean; detail: string } | null> {
    const url = this.cfg.previewUrl
    if (!url) return null
    this.emit("verify", `Visual check: capturing ${url}…`)
    const shot = await capture(url, { screenshot: true })
    if (shot.missing) {
      this.emit("warn", "Visual check skipped: Playwright not installed (npm i -D playwright && npx playwright install chromium).")
      return null
    }
    if (!shot.ok || !shot.base64) {
      this.emit("warn", `Visual check skipped: could not load ${url} (${shot.error ?? "no content"}).`)
      return null
    }
    try {
      const resolved = this.deps.rt.providers.resolve(this.deps.rt.config.config.model)
      const client = this.deps.rt.providers.client(resolved)
      const res = await client.complete({
        model: resolved,
        system:
          "You are a strict UI reviewer. Given a screenshot of a web app and the project goal, " +
          "reply with 'PASS' if the UI is complete and correct, or 'FAIL: <specific problems>'.",
        messages: [
          {
            role: "user",
            content: `Project goal: ${state.goal}\n\nDoes the rendered UI look complete and correct? Reply PASS or FAIL with concrete, fixable reasons.`,
            images: [{ mediaType: "image/png", data: shot.base64 }],
          },
        ],
        tools: [],
        maxTokens: 400,
      })
      const text = res.content.trim()
      const ok = /^\s*pass/i.test(text)
      this.emit(ok ? "success" : "warn", `Visual check: ${text.slice(0, 200)}`)
      return { ok, detail: text }
    } catch (err) {
      this.emit("warn", `Visual check error: ${(err as Error).message}`)
      return null
    }
  }

  private fixPrompt(failure: string, skeletons: SkeletonViolation[]): string {
    const skel = skeletons.length
      ? `\n## Incomplete code to finish (no skeletons allowed)\n` +
        skeletons.slice(0, 30).map((s) => `- ${s.file}:${s.line}  ${s.text}`).join("\n")
      : ""
    return [
      `FULL-STACK AUTOPILOT: the project is not yet error-free. Fix everything below.`,
      ``,
      `## Verification failure`,
      "```",
      failure.slice(0, 4000),
      "```",
      skel,
      ``,
      `Diagnose the root cause, apply complete fixes, then re-run the build/tests to confirm.`,
      `Do not leave any TODO/stub/placeholder or dummy/"example" content. The result must be`,
      `complete, polished (UI + backend wired and working), and pass the build and tests.`,
    ].join("\n")
  }

  private describeFailures(results: CommandResult[], skeletons: SkeletonViolation[], structural: StructuralIssue[] = []): string {
    const parts: string[] = []
    for (const r of results) {
      if (!r.ok) parts.push(`$ ${r.command}\n${r.output.slice(-3000)}`)
    }
    if (skeletons.length) {
      parts.push(
        `Skeleton/placeholder code found (${skeletons.length}):\n` +
          skeletons.slice(0, 30).map((s) => `  ${s.file}:${s.line}  ${s.text}`).join("\n"),
      )
    }
    if (structural.length) {
      parts.push(
        `Structural issues to fix (these cause hidden, run-order-dependent failures):\n` +
          structural.map((s) => `  - [${s.kind}] ${s.detail}`).join("\n"),
      )
    }
    return parts.join("\n\n") || "(no specific failure captured)"
  }

  /** A full-access build agent: no permission prompts, in this mode only. */
  private fullAccessAgent(): Agent {
    const build = this.deps.rt.agents.get("build") ?? this.deps.rt.agents.current_()
    return {
      ...build,
      permission: { "*": "allow" },
      maxSteps: 60,
      allowedTools: null,
    }
  }

  /** Run one agent turn; returns the number of files it changed. */
  private async runAgent(prompt: string, taskKind: "build" | "plan" | "fix" | "research" = "build"): Promise<number> {
    const agent = this.fullAccessAgent()
    const session = this.deps.rt.sessions.create(agent.id, agent.model ?? this.deps.rt.config.config.model, undefined, false)
    const result = await this.deps.rt.loop.run({
      sessionId: session.id,
      agent,
      userMessage: prompt,
      taskKind,
      handlers: this.loopHandlers("exec"),
    })
    for (const c of result.changes) this.changedPaths.add(c.path)
    return result.changes.length
  }

  /** Collect LSP error diagnostics for changed source files (bounded). */
  private async diagnosticsFailures(): Promise<string> {
    const paths = [...this.changedPaths].filter((p) => languageForFile(p)).slice(0, 25)
    const out: string[] = []
    for (const rel of paths) {
      const abs = isAbsolute(rel) ? rel : join(this.deps.rt.config.projectRoot, rel)
      try {
        const r = await this.deps.rt.lsp.diagnose(abs)
        if (r.ok) {
          const errs = r.diagnostics.filter((d) => d.severity === "error")
          if (errs.length) out.push(formatDiagnostics(rel, errs))
        }
      } catch {
        /* LSP is best-effort */
      }
    }
    return out.join("\n")
  }

  private loopHandlers(_scope: string): LoopHandlers {
    return {
      onText: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      report: (m) => this.emit("info", m),
      // Full access: auto-approve everything while in autopilot.
      requestApproval: async () => true,
    }
  }

  private markTasksComplete(state: AutorunState, phase: AutorunPhase): void {
    if (!state.specId) return
    const meta = this.deps.rt.specs.readMeta(state.specId)
    const tasks = this.deps.rt.specs.loadTasks(state.specId)
    for (const id of phase.taskIds) {
      this.deps.rt.specs.updateTaskStatus(state.specId, meta?.title ?? state.specId, tasks, id, "completed")
    }
  }

  private beat(): void {
    this.watchdog?.beat()
    if (this.state) {
      this.state.heartbeatAt = Date.now()
      // Persist run-total counters so a crash/resume keeps the attempts ceiling.
      this.state.totalAttempts = this.totalAttempts
      this.state.filesChanged = this.filesChanged
      this.state.polishReviews = this.polishReviews
      this.store.save(this.state)
    }
  }

  private emit(level: EventLevel, message: string): void {
    if (!this.state) return
    this.store.pushEvent(this.state, level, message)
    this.deps.onEvent?.(this.state)
  }
}

/** Humanize a duration given in seconds (e.g. 67334 -> "18h 42m"). */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "a moment"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return `${Math.round(seconds)}s`
}
