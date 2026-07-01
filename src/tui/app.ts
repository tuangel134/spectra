/**
 * Full-screen TUI application.
 *
 * The OpenCode-style interface: a centered logo and input box on launch,
 * transitioning to a scrolling chat view once you send a message. Handles raw
 * keyboard input, command palette, agent switching, and streaming responses.
 */

import { Screen } from "./screen.js"
import type { Key } from "./keys.js"
import { renderFrame, type ViewState, type RenderMessage } from "./layout.js"
import { type Flow, type FlowStep, resolveAnswer } from "./flow.js"
import { connectFlow, modelFlow, type FlowResult } from "./flows.js"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { resolve as resolvePathAbs, join as joinPath } from "node:path"
import { configDir } from "../util/platform.js"
import type { Runtime } from "../runtime.js"
import type { LoopHandlers } from "../session/loop.js"
import { saveModel } from "../config/writer.js"
import { filterCommands } from "../commands.js"
import { runSpecWorkflow, runSpecExecution, generateClarifyingQuestions, autoAnswerQuestions } from "../workflow/spec-workflow.js"
import { detectSpecIntent } from "../spec/detect.js"
import type { ClarifyQuestion, Clarification } from "../spec/clarify.js"
import { summarizeCost } from "../util/cost.js"

interface ActiveFlow {
  flow: Flow
  answers: string[]
  step: FlowStep
}

export class TuiApp {
  private readonly screen: Screen
  private state: ViewState
  private busy = false
  private flow: ActiveFlow | null = null
  private redoStack: import("../session/types.js").Snapshot[] = []
  private showDetails = true
  private showThinking = false
  private resolveExit!: () => void
  /** The user's chat session — kept stable so spec/subagent sessions can't hijack it. */
  private chatSessionId = ""
  /** Pending tool-approval resolver (supervised mode). */
  private pendingApproval: ((ok: boolean) => void) | null = null
  private pendingApprovalTool: string | null = null
  /** Tools the user chose to auto-allow for the rest of this session. */
  private readonly autoAllow = new Set<string>()
  /** Abort controller for the in-flight agent turn (Ctrl-C cancels it). */
  private turnAbort: AbortController | null = null
  /** The assistant message currently being streamed (token by token). */
  private streamingMsg: RenderMessage | null = null

  constructor(private readonly rt: Runtime) {
    this.screen = new Screen()
    const size = this.screen.size()
    const model = rt.config.config.model
    const providerId = model.split("/")[0] ?? ""

    this.state = {
      cols: size.cols,
      rows: size.rows,
      mode: "welcome",
      agent: rt.agents.current_().id,
      model,
      connected: rt.providers.hasCredentials(providerId),
      input: "",
      messages: [],
      busy: false,
      theme: rt.config.config.theme,
      tokens: { input: 0, output: 0 },
      version: "0.1.0",
    }
  }

  /** Run the app until the user quits. Resolves on exit. */
  run(opts?: { fresh?: boolean }): Promise<void> {
    // Resume the project's most recent session if there is one; otherwise start
    // fresh. This makes re-opening a project continue where the user left off.
    // `--new` (opts.fresh) forces a clean session.
    if (opts?.fresh || !this.resumeLastSession()) {
      const agent = this.rt.agents.current_()
      this.chatSessionId = this.rt.sessions.create(agent.id, agent.model ?? this.rt.config.config.model).id
    }

    this.screen.start()
    this.screen.onKey((key) => void this.onKey(key))
    this.screen.onResize((size) => {
      this.state.cols = size.cols
      this.state.rows = size.rows
      this.paint()
    })
    this.maybeOnboard()
    this.paint()

    return new Promise<void>((resolve) => {
      this.resolveExit = resolve
    })
  }

  /** One-time welcome + quick-start tips on the very first launch. */
  private maybeOnboard(): void {
    const marker = joinPath(configDir(), ".onboarded")
    if (existsSync(marker)) return
    try {
      mkdirSync(configDir(), { recursive: true })
      writeFileSync(marker, new Date().toISOString())
    } catch {
      /* if we can't persist the marker, still show it once this run */
    }
    this.enterChat()
    this.pushMessage("system", "Welcome to Spectra ⚡ — the spec-driven AI coding agent.")
    this.pushMessage("system", "Just type what you need — write code, fix a bug, or troubleshoot your computer. No modes to switch.")
    this.pushMessage(
      "system",
      "Handy: /help · /connect (add a provider) · /model (switch model) · Ctrl+K palette · ? shortcuts",
    )
    const providerId = this.rt.config.config.model.split("/")[0] ?? ""
    if (!this.rt.providers.hasCredentials(providerId)) {
      this.pushMessage(
        "system",
        "You're on the free model (no API key needed). Run /connect anytime to add Anthropic, OpenAI, Groq, Gemini, and more.",
      )
    }
  }

  private paint(): void {
    this.state.busy = this.busy
    this.state.agent = this.rt.agents.current_().id
    this.state.model = this.rt.config.config.model
    this.state.theme = this.rt.config.config.theme
    const session = this.chatSession()
    if (session) {
      this.state.tokens = { input: session.usage.inputTokens, output: session.usage.outputTokens }
    }
    this.screen.render(renderFrame(this.state))
  }

  /** The user's chat session (stable across spec/subagent runs). */
  private chatSession() {
    return this.rt.sessions.get(this.chatSessionId)
  }

  /** Repopulate the chat view from a given session's messages. */
  private loadSessionIntoView(session: { id: string; messages: { role: string; content: string }[] }): void {
    this.chatSessionId = session.id
    this.rt.sessions.setCurrent(session.id)
    this.state.messages = session.messages
      .filter((m) => m.role !== "tool" && m.content.trim().length > 0)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : "system",
        text: m.content,
      }))
    this.state.mode = "chat"
  }

  /** Resume the project's most recent session, repopulating the chat view. */
  private resumeLastSession(): boolean {
    const prior = this.rt.sessions.resumable()
    if (!prior) return false
    this.loadSessionIntoView(prior)
    this.state.messages.push({
      role: "system",
      text:
        `⟲ Resumed your last session (${prior.messages.length} messages).  ` +
        `Just type what you need — write code, run commands, or fix this computer (audio, wifi, drivers…).  ` +
        `/new = fresh session · /sessions = switch`,
    })
    return true
  }

  /** Switch to another project (reload the engine) and resume its session. */
  private async switchProject(path: string): Promise<void> {
    this.enterChat()
    if (!path) {
      this.pushMessage("system", "Usage: /open <path-to-project>")
      this.paint()
      return
    }
    const { resolve } = await import("node:path")
    const { existsSync, statSync } = await import("node:fs")
    const abs = resolve(this.rt.config.projectRoot, path)
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      this.pushMessage("system", `Not a directory: ${abs}`)
      this.paint()
      return
    }
    if (this.rt.autorun.running) {
      this.pushMessage("system", "Stop the Autopilot before switching projects (/autostop).")
      this.paint()
      return
    }

    this.busy = true
    this.pushMessage("system", `Opening ${abs}…`)
    this.paint()
    try {
      const { reloadRuntime, connectIntegrations } = await import("../runtime.js")
      reloadRuntime(this.rt, { cwd: abs })
      const { ProjectManager } = await import("../projects/index.js")
      new ProjectManager().add(abs)
      await connectIntegrations(this.rt)
    } catch (err) {
      this.busy = false
      this.pushMessage("system", `Failed to open project: ${(err as Error).message}`)
      this.paint()
      return
    }
    this.busy = false

    // Resume the new project's session (or start fresh), repopulating the view.
    this.state.messages = []
    if (!this.resumeLastSession()) {
      const agent = this.rt.agents.current_()
      this.chatSessionId = this.rt.sessions.create(agent.id, agent.model ?? this.rt.config.config.model).id
      this.pushMessage("system", `✓ Opened ${this.rt.config.projectRoot} (new session).`)
    } else {
      this.pushMessage("system", `✓ Opened ${this.rt.config.projectRoot}.`)
    }
    this.state.connected = this.rt.providers.hasCredentials(this.rt.config.config.model.split("/")[0] ?? "")
    this.paint()
  }

  private quit(): void {
    this.rt.sessions.flush()
    this.screen.stop()
    this.resolveExit?.()
  }

  // ---------------------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------------------

  private async onKey(key: Key): Promise<void> {
    // A pending tool approval (supervised mode) captures keys first, even while busy.
    if (this.pendingApproval) {
      this.handleApprovalKey(key)
      return
    }
    if (this.busy) {
      // While working, Ctrl+C cancels the current turn (a second one quits).
      if (key.name === "ctrl-c") {
        if (this.turnAbort && !this.turnAbort.signal.aborted) {
          this.turnAbort.abort()
          this.pushMessage("system", "⏹ Cancelling turn… (Ctrl-C again to quit)")
          this.paint()
        } else {
          this.quit()
        }
      }
      return
    }

    // When an interactive flow is active, route keys to it.
    if (this.flow) {
      await this.onFlowKey(key)
      return
    }

    switch (key.name) {
      case "ctrl-c":
      case "ctrl-d":
        this.quit()
        return
      case "enter":
        await this.submit()
        return
      case "up":
        if (this.state.menu) { this.state.menu.index = Math.max(0, this.state.menu.index - 1); break }
        return
      case "down":
        if (this.state.menu) {
          this.state.menu.index = Math.min(this.state.menu.items.length - 1, this.state.menu.index + 1)
          break
        }
        return
      case "tab":
        // If the slash menu is open, complete the highlighted command.
        if (this.state.menu && this.state.menu.items.length > 0) {
          this.state.input = this.state.menu.items[this.state.menu.index]!.command + " "
          this.updateMenu()
          break
        }
        this.rt.agents.cycle()
        break
      case "escape":
        if (this.state.menu) { this.state.menu = undefined; break }
        return
      case "backspace":
        this.state.input = this.state.input.slice(0, -1)
        this.updateMenu()
        break
      case "ctrl-u":
        this.state.input = ""
        this.updateMenu()
        break
      case "char":
        this.state.input += key.sequence
        this.updateMenu()
        break
      case "paste":
        // Collapse newlines to spaces: the composer is a single line, and a
        // multi-line paste should never auto-submit or corrupt the box.
        this.state.input += key.sequence.replace(/\s*\n\s*/g, " ").trimEnd()
        this.updateMenu()
        break
      default:
        return // ignore other keys
    }
    this.paint()
  }

  /** Recompute the slash-command menu from the current input. */
  private updateMenu(): void {
    const items = filterCommands(this.state.input)
    if (items.length > 0 && this.state.input.startsWith("/") && !this.state.input.includes(" ")) {
      const index = this.state.menu ? Math.min(this.state.menu.index, items.length - 1) : 0
      this.state.menu = {
        items: items.map((c) => ({ command: c.command, description: c.description, args: c.args })),
        index,
      }
    } else {
      this.state.menu = undefined
    }
  }

  // ---------------------------------------------------------------------------
  // Interactive flow engine (/connect, /model, …)
  // ---------------------------------------------------------------------------

  private beginFlow(flow: Flow): void {
    this.enterChat()
    this.pushMessage("system", flow.title)
    this.flow = { flow, answers: [], step: { question: "" } }
    this.advanceFlow()
  }

  private advanceFlow(): void {
    if (!this.flow) return
    const step = this.flow.flow.next(this.flow.answers)
    if (!step) {
      // Flow finished.
      const { flow, answers } = this.flow
      this.flow = null
      this.state.prompt = undefined
      this.state.mask = false
      void Promise.resolve(flow.complete(answers)).then(() => this.paint())
      return
    }

    this.flow.step = step
    this.state.prompt = step.question
    this.state.mask = Boolean(step.mask)

    // Render the question (and options) into the conversation.
    let msg = step.question
    if (step.options) {
      msg += "\n" + step.options.map((o, i) => `  ${i + 1}. ${o.label}`).join("\n")
    }
    this.pushMessage("system", msg)
    this.paint()
  }

  private async onFlowKey(key: Key): Promise<void> {
    switch (key.name) {
      case "escape":
        this.cancelFlow()
        return
      case "ctrl-c":
        this.quit()
        return
      case "enter": {
        const raw = this.state.input
        this.state.input = ""
        const step = this.flow!.step
        const { value, error } = resolveAnswer(step, raw)
        if (error) {
          this.pushMessage("system", error)
          this.paint()
          return
        }
        // Echo the answer (mask secrets).
        const echo = step.mask ? "•".repeat(raw.length) : value!
        this.pushMessage("user", echo)
        this.flow!.answers.push(value!)
        this.advanceFlow()
        return
      }
      case "backspace":
        this.state.input = this.state.input.slice(0, -1)
        break
      case "ctrl-u":
        this.state.input = ""
        break
      case "char":
        this.state.input += key.sequence
        break
      case "paste":
        this.state.input += key.sequence.replace(/\s*\n\s*/g, " ").trimEnd()
        break
      default:
        return
    }
    this.paint()
  }

  private cancelFlow(): void {
    this.flow = null
    this.state.prompt = undefined
    this.state.mask = false
    this.state.input = ""
    this.pushMessage("system", "Cancelled.")
    this.paint()
  }

  private onFlowResult = (result: FlowResult): void => {
    if (result.connectedProvider) this.state.connected = true
    // Apply a chosen model to the STABLE chat session (not sessions.current(),
    // which may be a transient spec/subagent session).
    if (result.modelToSet) {
      const session = this.chatSession()
      if (session) this.rt.sessions.setModel(session.id, result.modelToSet)
    }
    this.pushMessage("system", result.message)
    this.paint()
  }

  private async submit(): Promise<void> {
    const text = this.state.input.trim()
    this.state.menu = undefined
    if (!text) return
    this.state.input = ""

    if (text.startsWith("/")) {
      await this.runCommand(text)
      return
    }

    // `!command` runs a shell command and shows its output (like OpenCode).
    if (text.startsWith("!")) {
      await this.runShell(text.slice(1).trim())
      return
    }

    // Regular prompt: ensure we have credentials first.
    const providerId = this.rt.config.config.model.split("/")[0] ?? ""
    if (!this.rt.providers.hasCredentials(providerId)) {
      this.enterChat()
      this.pushMessage("system", `No provider connected for "${providerId}". Type /connect to add one.`)
      this.paint()
      return
    }

    // Expand `@path` file references into the prompt (like OpenCode).
    const expanded = this.expandFileRefs(text)

    this.enterChat()
    this.pushMessage("user", text)

    // Auto-detect a spec-worthy build request and offer the spec flow, unless
    // the user turned detection off (spec.detect = "off") or chose "auto".
    const detectMode = this.rt.config.config.spec.detect ?? "ask"
    if (detectMode !== "off") {
      const intent = detectSpecIntent(text)
      if (intent.spec) {
        if (detectMode === "auto") {
          await this.runSpecAuto(text)
        } else {
          this.beginSpecDecision(text, expanded)
        }
        return
      }
    }

    await this.runPrompt(expanded)
  }

  /** Replace `@path` tokens with the file's contents appended as context. */
  private expandFileRefs(text: string): string {
    const refs = text.match(/@([^\s]+)/g)
    if (!refs) return text
    let context = ""
    for (const ref of refs) {
      const path = ref.slice(1)
      try {
        const full = resolvePathAbs(this.rt.config.projectRoot, path)
        if (existsSync(full)) {
          const content = readFileSync(full, "utf-8").slice(0, 20_000)
          context += `\n\n--- ${path} ---\n${content}`
          this.pushMessage("tool", `@ attached ${path}`)
        }
      } catch {
        // ignore unreadable refs
      }
    }
    return context ? `${text}\n${context}` : text
  }

  /** Run a `!` shell command and add its output to the conversation. */
  private async runShell(command: string): Promise<void> {
    if (!command) return
    this.enterChat()
    this.pushMessage("user", `! ${command}`)
    this.busy = true
    this.paint()
    try {
      const { spawnSync } = await import("node:child_process")
      const { shellFor } = await import("../util/platform.js")
      const { file, args: shellArgs } = shellFor(command)
      const result = spawnSync(file, shellArgs, {
        cwd: this.rt.config.projectRoot,
        encoding: "utf-8",
        timeout: 60_000,
      })
      const out = ((result.stdout ?? "") + (result.stderr ?? "")).trim() || "(no output)"
      this.pushMessage("tool", out.slice(0, 4000))
    } catch (err) {
      this.pushMessage("system", `Shell error: ${(err as Error).message}`)
    } finally {
      this.busy = false
      this.paint()
    }
  }

  private enterChat(): void {
    this.state.mode = "chat"
  }

  private pushMessage(role: RenderMessage["role"], textValue: string): void {
    this.state.messages.push({ role, text: textValue })
  }

  // ---------------------------------------------------------------------------
  // Agent prompt
  // ---------------------------------------------------------------------------

  private handlers(): LoopHandlers {
    return {
      onText: (text) => {
        // Finalize a streamed message, or add a new one when not streaming.
        if (this.streamingMsg) {
          this.streamingMsg.text = text
          this.streamingMsg = null
        } else {
          this.pushMessage("assistant", text)
        }
        this.paint()
      },
      onTextChunk: (delta) => {
        if (!this.streamingMsg) {
          this.streamingMsg = { role: "assistant", text: "" }
          this.state.messages.push(this.streamingMsg)
        }
        this.streamingMsg.text += delta
        this.paint()
      },
      onToolStart: (name, args) => {
        this.streamingMsg = null
        this.pushMessage("tool", `⚙ ${name} ${this.argHint(name, args)}`)
        this.paint()
      },
      onToolEnd: (name, success, output) => {
        const mark = success ? "✓" : "✗"
        this.pushMessage("tool", `${mark} ${name}: ${output.split("\n")[0]?.slice(0, 80) ?? ""}`)
        this.paint()
      },
      report: (message) => {
        this.pushMessage("tool", message)
        this.paint()
      },
      // Supervised mode: honor the permission system. A tool whose permission is
      // "ask" pauses here for a real y/n/a decision instead of auto-approving.
      requestApproval: (toolName, detail) => {
        if (this.autoAllow.has(toolName)) return Promise.resolve(true)
        return new Promise<boolean>((resolve) => {
          this.pendingApproval = resolve
          this.pendingApprovalTool = toolName
          this.pushMessage("system", `⚠ Approve ${toolName}? ${detail}`)
          this.state.status = "⚠ approve: [y] allow · [a] always · [n] deny"
          this.paint()
        })
      },
    }
  }

  /** Route a keystroke to a pending approval prompt. */
  private handleApprovalKey(key: Key): void {
    if (key.name === "ctrl-c") {
      this.resolveApproval(false)
      this.quit()
      return
    }
    if (key.name === "enter") return this.resolveApproval(true)
    if (key.name === "escape") return this.resolveApproval(false)
    if (key.name === "char") {
      const c = key.sequence.toLowerCase()
      if (c === "y") return this.resolveApproval(true)
      if (c === "n") return this.resolveApproval(false)
      if (c === "a") {
        if (this.pendingApprovalTool) this.autoAllow.add(this.pendingApprovalTool)
        return this.resolveApproval(true)
      }
    }
  }

  private resolveApproval(ok: boolean): void {
    const resolve = this.pendingApproval
    this.pendingApproval = null
    this.pendingApprovalTool = null
    this.state.status = undefined
    this.pushMessage("tool", ok ? "✓ approved" : "✗ denied")
    this.paint()
    resolve?.(ok)
  }

  private argHint(name: string, args: Record<string, unknown>): string {
    if (name === "bash") return String(args["command"] ?? "")
    return String(args["path"] ?? args["pattern"] ?? args["url"] ?? "")
  }

  private async runPrompt(text: string): Promise<void> {
    const session = this.chatSession()
    if (!session) return
    this.busy = true
    this.turnAbort = new AbortController()
    this.paint()
    try {
      await this.rt.loop.run({
        sessionId: session.id,
        agent: this.rt.agents.current_(),
        userMessage: text,
        handlers: this.handlers(),
        signal: this.turnAbort.signal,
      })
    } catch (err) {
      this.pushMessage("system", `Error: ${(err as Error).message}`)
    } finally {
      this.busy = false
      this.turnAbort = null
      this.paint()
    }
  }

  // ---------------------------------------------------------------------------
  // Spec auto-detection flow (questions / auto / reject)
  // ---------------------------------------------------------------------------

  /** Offer the three choices when a build request is detected. */
  private beginSpecDecision(rawText: string, expandedText: string): void {
    const self = this
    const flow: Flow = {
      title: "📋 This looks like something to build. How should I spec it?",
      next(answers: string[]): FlowStep | null {
        if (answers.length === 0) {
          return {
            question: "Choose how to proceed:",
            options: [
              { label: "Answer a few clarifying questions (best specs)", value: "questions" },
              { label: "Auto — let Spectra pick sensible specs", value: "auto" },
              { label: "No spec — just build it now", value: "build" },
            ],
          }
        }
        return null
      },
      async complete(answers: string[]): Promise<void> {
        const choice = answers[0]
        if (choice === "auto") await self.runSpecAuto(rawText)
        else if (choice === "questions") await self.runClarifyThenSpec(rawText)
        else await self.runPrompt(expandedText)
      },
    }
    this.beginFlow(flow)
  }

  /** Auto mode: the model drafts decisions, the user confirms / edits / cancels. */
  private async runSpecAuto(description: string): Promise<void> {
    this.busy = true
    this.pushMessage("system", "🤖 Auto spec: drafting decisions…")
    this.paint()
    let questions: ClarifyQuestion[] = []
    let answers: Clarification[] = []
    try {
      questions = await generateClarifyingQuestions(this.rt, description)
      answers = await autoAnswerQuestions(this.rt, description, questions)
    } catch {
      questions = []
      answers = []
    } finally {
      this.busy = false
      this.paint()
    }
    if (answers.length === 0) {
      await this.generateSpec(description, [])
      return
    }
    this.pushMessage("system", "🤖 Spectra chose these decisions:")
    for (const a of answers) this.pushMessage("tool", `• ${a.question} → ${a.answer}`)
    this.paint()
    this.beginFlow(this.autoConfirmFlow(description, questions, answers))
  }

  /** Confirm the auto-chosen decisions, edit them, or cancel. */
  private autoConfirmFlow(description: string, questions: ClarifyQuestion[], answers: Clarification[]): Flow {
    const self = this
    return {
      title: "Use these decisions?",
      next(ans: string[]): FlowStep | null {
        if (ans.length === 0) {
          return {
            question: "Proceed with these auto decisions?",
            options: [
              { label: "Generate the spec with these", value: "yes" },
              { label: "Edit — answer the questions myself", value: "edit" },
              { label: "Cancel", value: "cancel" },
            ],
          }
        }
        return null
      },
      async complete(ans: string[]): Promise<void> {
        const c = ans[0]
        if (c === "yes") await self.generateSpec(description, answers)
        else if (c === "edit") self.beginFlow(self.clarifyFlow(description, questions))
        else self.pushMessage("system", "Cancelled.")
      },
    }
  }

  /** Questions mode: fetch clarifying questions, then run an interactive flow. */
  private async runClarifyThenSpec(description: string): Promise<void> {
    this.busy = true
    this.pushMessage("system", "Thinking of a few clarifying questions…")
    this.paint()
    let questions: ClarifyQuestion[] = []
    try {
      questions = await generateClarifyingQuestions(this.rt, description)
    } catch {
      questions = []
    } finally {
      this.busy = false
      this.paint()
    }

    if (questions.length === 0) {
      // Couldn't form questions — generate a spec directly from the description.
      await this.generateSpec(description, [])
      return
    }
    this.beginFlow(this.clarifyFlow(description, questions))
  }

  /** Build the interactive multiple-choice + free-text clarification flow. */
  private clarifyFlow(description: string, questions: ClarifyQuestion[]): Flow {
    const self = this
    return {
      title: `Let's clarify ${questions.length} thing(s) — pick a number or type your own answer.`,
      next(answers: string[]): FlowStep | null {
        const i = answers.length
        if (i >= questions.length) return null
        const q = questions[i]!
        return {
          question: `(${i + 1}/${questions.length}) ${q.question}`,
          options: q.options.map((o) => ({ label: o, value: o })),
          allowFreeText: true,
        }
      },
      async complete(answers: string[]): Promise<void> {
        const clar: Clarification[] = questions.map((q, i) => ({
          question: q.question,
          answer: answers[i] ?? q.options[0] ?? "",
        }))
        await self.generateSpec(description, clar)
      },
    }
  }

  /** Run the spec workflow with the given (possibly empty) clarifications. */
  private async generateSpec(description: string, clarifications: Clarification[]): Promise<void> {
    this.busy = true
    this.paint()
    try {
      await runSpecWorkflow(this.rt, description, this.silentHandlers(), clarifications)
      this.pushMessage("system", "✓ Spec generated. Run it with /run <spec-id> (see .spectra/specs).")
    } catch (err) {
      this.pushMessage("system", `Error: ${(err as Error).message}`)
    } finally {
      this.busy = false
      this.paint()
    }
  }

  // ---------------------------------------------------------------------------
  // Commands (subset usable from the TUI; full text flows live here)
  // ---------------------------------------------------------------------------

  private async runCommand(input: string): Promise<void> {
    const [cmd, ...rest] = input.slice(1).split(/\s+/)
    const arg = rest.join(" ")

    switch (cmd) {
      case "exit":
      case "quit":
      case "q":
        this.quit()
        return

      case "help":
        this.enterChat()
        this.pushMessage("system", this.helpText())
        break

      case "connect":
        this.beginFlow(connectFlow(this.rt, this.onFlowResult))
        return

      case "model":
        if (arg) {
          // Direct set: /model <id>
          this.rt.config.config.model = arg
          const session = this.chatSession()
          if (session) this.rt.sessions.setModel(session.id, arg)
          saveModel(arg)
          this.enterChat()
          this.pushMessage("system", `✓ Model set to ${arg}.`)
          break
        }
        // Interactive picker.
        this.beginFlow(modelFlow(this.rt, this.onFlowResult))
        return

      case "models":
        // /models opens the model picker; /connect is for providers.
        this.beginFlow(modelFlow(this.rt, this.onFlowResult))
        return

      case "agent": {
        if (arg) {
          this.rt.agents.setCurrent(arg)
          this.state.agent = this.rt.agents.current_().id
          this.enterChat()
          this.pushMessage("system", `✓ Agent set to ${this.state.agent}.`)
        } else {
          this.enterChat()
          this.pushMessage(
            "system",
            "Agents (use /agent <id> to switch):\n" +
              this.rt.agents.all().map((a) => `  ${a.id.padEnd(9)} — ${a.description}`).join("\n"),
          )
        }
        break
      }

      case "ops":
      case "fix":
      case "doctor": {
        this.rt.agents.setCurrent("ops")
        this.state.agent = this.rt.agents.current_().id
        this.enterChat()
        this.pushMessage(
          "system",
          "🔧 OPS mode — I can diagnose and fix THIS machine: audio, microphone, " +
            "networking/Wi-Fi, Bluetooth, graphics/drivers, systemd services, and packages.\n" +
            'Describe the problem in plain words, e.g. "no sound from my speakers", "wifi keeps dropping", ' +
            'or "my nvidia driver isn\'t loading".\n' +
            "I run read-only diagnostics freely; anything privileged (sudo) or destructive asks for approval first.",
        )
        break
      }

      case "clear":
      case "new": {
        this.state.messages = []
        this.state.mode = "welcome"
        const agent = this.rt.agents.current_()
        this.chatSessionId = this.rt.sessions.create(agent.id, agent.model ?? this.rt.config.config.model).id
        break
      }

      case "spec": {
        if (!arg) {
          this.enterChat()
          this.pushMessage("system", "Usage: /spec <feature description>")
          break
        }
        this.enterChat()
        this.busy = true
        this.paint()
        try {
          await runSpecWorkflow(this.rt, arg, this.silentHandlers())
          this.pushMessage("system", "Spec generated. See .spectra/specs. Use /run <id> to execute.")
        } catch (err) {
          this.pushMessage("system", `Error: ${(err as Error).message}`)
        } finally {
          this.busy = false
        }
        break
      }

      case "specmode": {
        this.enterChat()
        const m = arg.trim()
        if (!["ask", "auto", "off"].includes(m)) {
          this.pushMessage(
            "system",
            `Spec detection is "${this.rt.config.config.spec.detect ?? "ask"}". Usage: /specmode <ask|auto|off>\n` +
              "  ask  — detect build requests and offer questions / auto / reject\n" +
              "  auto — detect and let Spectra pick sensible specs automatically\n" +
              "  off  — never auto-detect; use /spec explicitly",
          )
          break
        }
        this.rt.config.config.spec.detect = m as "ask" | "auto" | "off"
        const { saveSpecDetect } = await import("../config/writer.js")
        saveSpecDetect(m as "ask" | "auto" | "off", this.rt.config.projectRoot)
        this.pushMessage("system", `✓ Spec auto-detection set to ${m}.`)
        break
      }

      case "supervise": {
        this.enterChat()
        const a = arg.trim()
        const guarded = ["edit", "write", "bash"]
        const { savePermission, saveAutoApprove } = await import("../config/writer.js")
        if (a === "on" || a === "off") {
          const supervised = a === "on"
          this.rt.config.config.autoApprove = !supervised
          saveAutoApprove(!supervised, this.rt.config.projectRoot)
          const level = supervised ? "ask" : "allow"
          for (const t of guarded) {
            this.rt.config.config.permission[t] = level
            savePermission(t, level, this.rt.config.projectRoot)
          }
          if (!supervised) this.autoAllow.clear()
          this.pushMessage(
            "system",
            supervised
              ? "🔒 Supervised mode ON — edits, writes and shell commands now ask for approval ([y]/[a]/[n]). (The Full-Stack Autopilot still runs unattended.)"
              : "🔓 Supervised mode OFF — tool actions auto-approve and run without prompting (deny rules still apply).",
          )
        } else {
          this.pushMessage(
            "system",
            `Usage: /supervise <on|off>. Auto-approve is currently ${this.rt.config.config.autoApprove ? "ON (no prompts)" : "OFF (supervised)"}.`,
          )
        }
        break
      }

      case "run": {
        if (!arg) {
          this.enterChat()
          this.pushMessage("system", "Usage: /run <spec-id>")
          break
        }
        this.enterChat()
        this.busy = true
        this.paint()
        try {
          await runSpecExecution(this.rt, arg, this.silentHandlers())
        } catch (err) {
          this.pushMessage("system", `Error: ${(err as Error).message}`)
        } finally {
          this.busy = false
        }
        break
      }

      case "autorun": {
        if (!arg) {
          this.enterChat()
          this.pushMessage("system", "Usage: /autorun <project goal>. The Autopilot will plan and build the whole project autonomously.")
          break
        }
        this.enterChat()
        this.pushMessage("system", `🚀 Full-Stack Autopilot started. It will plan, build, verify and self-heal until the project is complete.\nGoal: ${arg}\nUse /autostop to pause, /autoresume to continue.`)
        try {
          this.rt.autorun.start(arg)
        } catch (err) {
          this.pushMessage("system", `Error: ${(err as Error).message}`)
        }
        break
      }

      case "autostop": {
        this.enterChat()
        this.rt.autorun.cancel()
        this.pushMessage("system", "⏸ Autopilot will pause after the current step.")
        break
      }

      case "autoresume": {
        this.enterChat()
        const resumed = this.rt.autorun.resume()
        this.pushMessage("system", resumed ? `⟳ Resuming autorun ${resumed.id}.` : "No resumable autorun found.")
        break
      }

      case "undo": {
        const session = this.chatSession()
        const snap = session ? this.rt.sessions.popSnapshot(session.id) : null
        this.enterChat()
        if (!snap) {
          this.pushMessage("system", "Nothing to undo.")
          break
        }
        const { applyUndo } = await import("../workflow/undo.js")
        const count = applyUndo(this.rt.config.projectRoot, snap)
        if (session) this.redoStack.push(snap)
        this.pushMessage("system", `↩ Reverted ${count} file change(s). /redo to restore.`)
        break
      }

      case "redo": {
        const snap = this.redoStack.pop()
        this.enterChat()
        if (!snap) {
          this.pushMessage("system", "Nothing to redo.")
          break
        }
        const { applyRedo } = await import("../workflow/undo.js")
        const count = applyRedo(this.rt.config.projectRoot, snap)
        const session = this.chatSession()
        if (session) this.rt.sessions.snapshot(session.id, snap.changes)
        this.pushMessage("system", `↪ Restored ${count} file change(s).`)
        break
      }

      case "sessions":
      case "resume":
      case "continue": {
        this.enterChat()
        const sessions = this.rt.sessions.list()
        if (!sessions.length) {
          this.pushMessage("system", "No sessions yet. Just type a message to start one.")
          break
        }
        const a = arg.trim()
        if (a) {
          // Switch by 1-based index or by (partial) id.
          const target = /^\d+$/.test(a)
            ? sessions[Number(a) - 1]
            : sessions.find((s) => s.id === a || s.id.startsWith(a))
          if (!target) {
            this.pushMessage("system", `No session "${a}". Type /sessions to list them.`)
            break
          }
          this.loadSessionIntoView(target)
          this.pushMessage(
            "system",
            `⟲ Switched to session ${target.id} — "${target.title}" (${target.messages.length} messages).`,
          )
          break
        }
        const cur = this.chatSessionId
        const lines = sessions.map(
          (s, i) => `${s.id === cur ? "●" : " "} ${String(i + 1).padStart(2)}. ${s.title} · ${s.messages.length} msgs · ${s.id}`,
        )
        this.pushMessage(
          "system",
          "Sessions (● = current):\n" +
            lines.join("\n") +
            "\n\n/resume <number> — switch to a session   ·   /new — start a fresh one",
        )
        break
      }

      case "projects": {
        this.enterChat()
        const { ProjectManager } = await import("../projects/index.js")
        const cur = this.rt.config.projectRoot
        const list = new ProjectManager().list()
        const lines = list.length
          ? list.map((p) => `${p.path === cur ? "● " : "  "}${p.name} — ${p.path}`).join("\n")
          : "(no projects registered yet)"
        this.pushMessage("system", `Projects (use /open <path> to switch):\n${lines}\n\nCurrent: ${cur}`)
        break
      }

      case "open": {
        await this.switchProject(arg.trim())
        break
      }

      case "compact":
      case "summarize": {
        this.enterChat()
        await this.compactSession()
        break
      }

      case "stats": {
        this.enterChat()
        this.pushMessage("system", this.statsText())
        break
      }

      case "headroom": {
        this.enterChat()
        this.pushMessage("system", this.headroomText())
        break
      }

      case "routing": {
        this.enterChat()
        const r = this.rt.config.config.routing
        const lines = [`Model routing: ${r.mode}`]
        if (r.mode === "semi") {
          const a = r.assignments ?? {}
          const keys = Object.keys(a)
          lines.push(keys.length ? "  assignments:" : "  (no per-task assignments; using main model)")
          for (const k of keys) lines.push(`    ${k} → ${a[k]}`)
        }
        const ac = r.autochange
        lines.push(`  autochange: ${ac?.enabled ? "ON" : "off"}${ac?.fallbacks?.length ? " → " + ac.fallbacks.join(" → ") : ""}`)
        lines.push(`  main model: ${this.rt.config.config.model}`)
        this.pushMessage("system", lines.join("\n"))
        break
      }

      case "cost": {
        this.enterChat()
        this.pushMessage("system", this.statsText())
        break
      }

      case "mcp": {
        this.enterChat()
        const servers = this.rt.mcp.status()
        if (servers.length === 0) {
          this.pushMessage("system", "No MCP servers configured. Add one in .spectra/mcp.json or the Config tab.")
          break
        }
        const lines = servers.map((s) => {
          const head = `${s.connected ? "●" : "○"} ${s.name} (${s.type})`
          const detail = s.connected ? `${s.toolCount} tools: ${s.tools.join(", ")}` : s.error ?? "not connected"
          return `  ${head}\n    ${detail}`
        })
        this.pushMessage("system", "MCP servers:\n" + lines.join("\n"))
        break
      }

      case "skills": {
        this.enterChat()
        const skills = this.rt.skills.list()
        this.pushMessage(
          "system",
          skills.length
            ? "Available skills (call the `skill` tool to use one):\n" +
                skills.map((s) => `  - ${s.name} [${s.source}]: ${s.description}`).join("\n")
            : "No skills installed. Add one at .spectra/skills/<name>/SKILL.md",
        )
        break
      }

      case "plugins": {
        this.enterChat()
        const plugins = this.rt.plugins.list()
        this.pushMessage(
          "system",
          plugins.length
            ? "Loaded plugins:\n" +
                plugins.map((p) => `  - ${p.name}${p.error ? ` (error: ${p.error})` : ` (+${p.tools.length} tools)`}`).join("\n")
            : "No plugins. Drop a .js/.mjs in .spectra/plugins that default-exports function({registerTool}).",
        )
        break
      }

      case "eval": {
        this.enterChat()
        const { runEvals } = await import("../eval/index.js")
        const report = await runEvals()
        const lines = report.results.map((r) => `  ${r.pass ? "✓" : "✗"} ${r.name} — ${Math.round(r.score * 100)}% (${r.detail})`)
        this.pushMessage(
          "system",
          `Capability eval: ${report.passed}/${report.total} passed · avg ${Math.round(report.averageScore * 100)}%\n` + lines.join("\n"),
        )
        break
      }

      case "themes":
      case "theme": {
        if (arg) {
          const { THEMES } = await import("./theme.js")
          if (!THEMES[arg]) {
            this.enterChat()
            this.pushMessage("system", `Unknown theme "${arg}". Available: ${Object.keys(THEMES).join(", ")}`)
            break
          }
          this.rt.config.config.theme = arg
          const { updateConfig, globalConfigPath } = await import("../config/writer.js")
          updateConfig(globalConfigPath(), (c) => (c.theme = arg))
          this.pushMessage("system", `✓ Theme set to ${arg}.`)
          break
        }
        const { THEMES } = await import("./theme.js")
        this.enterChat()
        this.pushMessage(
          "system",
          "Themes (use /theme <id>):\n" +
            Object.values(THEMES).map((t) => `  ${t.id} — ${t.name}`).join("\n"),
        )
        break
      }

      case "details":
        this.showDetails = !this.showDetails
        this.enterChat()
        this.pushMessage("system", `Tool details ${this.showDetails ? "shown" : "hidden"}.`)
        break

      case "thinking":
        this.showThinking = !this.showThinking
        this.enterChat()
        this.pushMessage("system", `Thinking blocks ${this.showThinking ? "shown" : "hidden"}.`)
        break

      case "export": {
        this.enterChat()
        const path = this.exportConversation()
        this.pushMessage("system", path ? `✓ Exported to ${path}` : "Nothing to export.")
        break
      }

      case "init": {
        this.enterChat()
        this.busy = true
        this.paint()
        await this.runPrompt(
          "Analyze this project and create or update an AGENTS.md file at the project root " +
            "describing the build/test commands, code conventions, and architecture. Keep it concise.",
        )
        break
      }

      case "share":
      case "unshare":
        this.enterChat()
        this.pushMessage(
          "system",
          "Sharing needs a Spectra share backend, which isn't configured. " +
            "Use /export to save the conversation to a local Markdown file instead.",
        )
        break

      case "editor":
        this.enterChat()
        this.pushMessage(
          "system",
          "External editor composing works in line mode (run `spectra` without a TTY-based flow). " +
            "In the TUI, type directly or paste multi-line text.",
        )
        break

      default:
        this.enterChat()
        this.pushMessage("system", `Unknown command: /${cmd}. Type /help.`)
    }
    this.paint()
  }

  /** Handlers that route workflow output into the chat message list. */
  private silentHandlers(): LoopHandlers {
    return {
      onText: (text) => {
        this.pushMessage("assistant", text)
        this.paint()
      },
      onToolStart: () => {},
      onToolEnd: () => {},
      report: (m) => {
        this.pushMessage("tool", m)
        this.paint()
      },
      requestApproval: async () => true,
    }
  }

  /** Summarize the session history into a compact system note (token saver). */
  private async compactSession(): Promise<void> {
    const session = this.chatSession()
    if (!session || session.messages.length === 0) {
      this.pushMessage("system", "Nothing to compact.")
      return
    }
    const before = session.messages.length
    // Keep the last few turns; replace the rest with a short marker.
    const keep = 4
    if (before <= keep) {
      this.pushMessage("system", "Session already compact.")
      return
    }
    const marker = {
      role: "system" as const,
      content: `[${before - keep} earlier messages compacted to save context]`,
    }
    // Avoid an orphaned tool result at the head of the kept tail: its matching
    // assistant tool_call was just compacted away, which some providers reject.
    let kept = session.messages.slice(before - keep)
    while (kept.length > 0 && kept[0]!.role === "tool") kept = kept.slice(1)
    // Route through the manager so updatedAt is bumped and the change is
    // persisted immediately (a raw splice left it in memory only).
    this.rt.sessions.setMessages(session.id, [marker, ...kept])
    this.pushMessage("system", `✓ Compacted ${before - kept.length} messages.`)
  }

  private statsText(): string {
    const sessions = this.rt.sessions.list()
    let inTok = 0
    let outTok = 0
    for (const s of sessions) {
      inTok += s.usage.inputTokens
      outTok += s.usage.outputTokens
    }
    const { usd } = summarizeCost(sessions)
    return [
      "Usage this run:",
      `  sessions:      ${sessions.length}`,
      `  input tokens:  ${inTok}`,
      `  output tokens: ${outTok}`,
      `  est. cost:     ~$${usd.toFixed(4)}`,
      `  model:         ${this.rt.config.config.model}`,
      `  routing:       ${this.rt.config.config.routing.mode}${this.rt.config.config.routing.autochange?.enabled ? " + autochange" : ""}`,
    ].join("\n")
  }

  private headroomText(): string {
    const hr = this.rt.headroom
    const s = hr.getStats()
    const saved = Math.max(0, s.originalTokens - s.compressedTokens)
    const pct = s.originalTokens ? Math.round((saved / s.originalTokens) * 100) : 0
    return [
      `Headroom compression (${hr.enabled ? "on" : "off"}):`,
      `  payloads seen:       ${s.payloads}`,
      `  payloads compressed: ${s.compressedPayloads}`,
      `  tokens before:       ${s.originalTokens}`,
      `  tokens after:        ${s.compressedTokens}`,
      `  tokens saved:        ${saved} (${pct}%)`,
      `  originals cached:    ${s.stored}`,
    ].join("\n")
  }

  private exportConversation(): string | null {
    const session = this.chatSession()
    if (!session || session.messages.length === 0) return null
    const lines = [`# Spectra session ${session.id}`, "", `Model: ${session.model}`, ""]
    for (const m of session.messages) {
      if (m.role === "user") lines.push(`## You\n\n${m.content}\n`)
      else if (m.role === "assistant") lines.push(`## Spectra\n\n${m.content}\n`)
    }
    const dir = joinPath(this.rt.config.projectRoot, ".spectra", "exports")
    mkdirSync(dir, { recursive: true })
    const path = joinPath(dir, `${session.id}.md`)
    writeFileSync(path, lines.join("\n"), "utf-8")
    return path
  }

  private helpText(): string {
    return [
      "Commands (also work with / in chat):",
      "  /ops                  Fix THIS computer — audio, wifi, drivers, services (aliases: /fix, /doctor)",
      "  /connect              Connect a provider (Zen, Go, OpenAI, Ollama, custom)",
      "  /model [id]           Switch model (interactive picker)",
      "  /models               List providers and models",
      "  /agent [id]           List or switch agents (build, plan, ops, security…)",
      "  /spec <desc>          Generate a spec (requirements, design, tasks)",
      "  /run <spec-id>        Execute a spec in parallel waves",
      "  /autorun <goal>       Full-Stack Autopilot: build a whole project autonomously",
      "  /undo  /redo          Revert / restore file changes",
      "  /supervise <on|off>   Approve edits/writes/commands before they run",
      "",
      "  Sessions & projects:",
      "  /new                  Start a FRESH session (alias: /clear)",
      "  /sessions             List sessions — then /resume <number> to switch to one",
      "  /resume <n|id>        Switch to a specific past session",
      "  /projects             List your projects",
      "  /open <path>          Switch to another project (resumes its session)",
      "",
      "  /compact              Shrink context (alias: /summarize)",
      "  /stats  /headroom     Token usage / compression savings this run",
      "  /export               Save the conversation to Markdown",
      "  /init                 Generate AGENTS.md for this project",
      "  /theme [id]           Change theme (prism, aurora, ember, mono)",
      "  /details  /thinking   Toggle tool details / reasoning blocks",
      "  /exit                 Quit (aliases: /quit, /q)",
      "",
      "Input:  @path attaches a file · !cmd runs a shell command",
      "Keys:   tab switch agent · esc cancel prompt · ctrl+c quit",
    ].join("\n")
  }
}
