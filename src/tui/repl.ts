/**
 * Interactive terminal REPL.
 *
 * The primary way users interact with Spectra. Everything configurable is
 * reachable from inside the interface: connecting providers, switching models,
 * adjusting permissions, and running specs. Changes persist to the config file
 * automatically and take effect immediately.
 */

import * as readline from "node:readline/promises"
import { stdin, stdout } from "node:process"

import type { Runtime } from "../runtime.js"
import type { LoopHandlers } from "../session/loop.js"
import { color, BRAND } from "../util/logger.js"
import { runSpecWorkflow, runSpecExecution, generateClarifyingQuestions, autoAnswerQuestions } from "../workflow/spec-workflow.js"
import { detectSpecIntent } from "../spec/detect.js"
import type { Clarification, ClarifyQuestion } from "../spec/clarify.js"
import { ProjectManager } from "../projects/index.js"
import { expandFileMentions } from "../context/mentions.js"
import { saveProviderKey, saveModel, savePermission, saveSpecDetect } from "../config/writer.js"
import { ZEN_MODELS } from "../provider/zen.js"

/** Providers offered in the interactive /connect picker. */
const CONNECTABLE_PROVIDERS: { id: string; name: string; hint: string; baseURL?: string }[] = [
  { id: "opencode", name: "OpenCode Zen", hint: "key from opencode.ai/auth" },
  { id: "anthropic", name: "Anthropic", hint: "key from console.anthropic.com" },
  { id: "openai", name: "OpenAI", hint: "key from platform.openai.com" },
  { id: "google", name: "Google Gemini", hint: "key from aistudio.google.com" },
  {
    id: "ollama",
    name: "Ollama (local, no key)",
    hint: "runs locally",
    baseURL: "http://localhost:11434/v1",
  },
  { id: "custom", name: "Custom (OpenAI-compatible base URL)", hint: "your own endpoint" },
]

export class Repl {
  private readonly rl: readline.Interface
  private readonly out: NodeJS.WritableStream
  private running = true
  private closed = false
  /** The user's chat session — kept stable so spec/subagent sessions can't hijack it. */
  private chatSessionId = ""

  constructor(
    private readonly rt: Runtime,
    io?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream },
  ) {
    const input = io?.input ?? stdin
    this.out = io?.output ?? stdout
    this.rl = readline.createInterface({ input, output: this.out })
    // Exit cleanly when the input stream ends (EOF / pipe / Ctrl-D).
    this.rl.on("close", () => {
      this.closed = true
      this.running = false
    })
  }

  /** Ask a question but resolve to null if the stream closes meanwhile. */
  private async ask(prompt: string): Promise<string | null> {
    if (this.closed) return null
    return new Promise<string | null>((resolve) => {
      let done = false
      const finish = (v: string | null): void => {
        if (done) return
        done = true
        this.rl.removeListener("close", onClose)
        resolve(v)
      }
      const onClose = (): void => finish(null)
      this.rl.once("close", onClose)
      this.rl.question(prompt).then(
        (answer) => finish(answer),
        () => finish(null),
      )
    })
  }

  async start(opts?: { fresh?: boolean }): Promise<void> {
    const { agents, config } = this.rt
    const agent = agents.current_()
    // Resume the project's most recent session, or start a fresh one.
    const prior = opts?.fresh ? null : this.rt.sessions.resumable()
    if (prior) {
      this.chatSessionId = prior.id
      this.rt.sessions.setCurrent(prior.id)
    } else {
      this.chatSessionId = this.rt.sessions.create(agent.id, agent.model ?? config.config.model).id
    }

    this.printWelcome()
    if (prior) {
      this.out.write(color.gray(`⟲ Resumed your last session (${prior.messages.length} messages).\n`))
      this.out.write(color.gray(`   Just type what you need — code, commands, or fix this computer (audio, wifi, drivers…).\n`))
      this.out.write(color.gray(`   /new = fresh session · /sessions then /resume <n> = switch\n\n`))
    }

    while (this.running) {
      const agentName = this.rt.agents.current_().id
      const prompt = color.cyan(`spectra:${agentName}`) + color.gray(" › ")
      const raw = await this.ask(prompt)
      if (raw === null) break // stream closed / Ctrl-D
      const input = raw.trim()
      if (!input) continue
      if (input.startsWith("/")) {
        await this.handleCommand(input)
        continue
      }
      await this.handlePrompt(input)
    }

    if (!this.closed) this.rl.close()
    this.rt.sessions.flush()
  }

  private printWelcome(): void {
    const model = this.rt.config.config.model
    const providerId = model.split("/")[0] ?? ""
    const connected = this.rt.providers.hasCredentials(providerId)

    this.out.write(`\n${BRAND} ${color.gray("v0.1.0")}\n`)
    this.out.write(color.gray(`model: ${model}  ·  project: ${this.rt.config.projectRoot}\n`))
    if (!connected) {
      this.out.write(
        color.gray("Tip: ") +
          color.gray(`run ${color.cyan("/connect")} to add a provider (OpenCode Zen, local Ollama, custom API).\n`),
      )
    }
    this.out.write(color.gray("Type a prompt, or /help for commands. /exit to quit.\n\n"))
  }

  // ---------------------------------------------------------------------------
  // Interactive configuration flows
  // ---------------------------------------------------------------------------

  /** Interactive provider connection: pick provider, enter key, persist. */
  private async connectFlow(): Promise<void> {
    this.out.write(color.bold("Connect a provider:\n"))
    CONNECTABLE_PROVIDERS.forEach((p, i) => {
      this.out.write(`  ${color.cyan(String(i + 1))}. ${p.name} ${color.gray("— " + p.hint)}\n`)
    })

    const choice = (await this.rl.question(color.gray("Select a number (or Enter to cancel): "))).trim()
    if (!choice) {
      this.out.write(color.gray("Cancelled.\n"))
      return
    }
    const index = Number(choice) - 1
    const provider = CONNECTABLE_PROVIDERS[index]
    if (!provider) {
      this.out.write(color.red("Invalid selection.\n"))
      return
    }

    let providerId = provider.id
    let baseURL = provider.baseURL

    if (provider.id === "custom") {
      providerId = (await this.rl.question(color.gray("Provider id (e.g. my-api): "))).trim()
      if (!providerId) {
        this.out.write(color.red("Cancelled.\n"))
        return
      }
      baseURL = (await this.rl.question(color.gray("Base URL (e.g. https://host/v1): "))).trim()
      if (!baseURL) {
        this.out.write(color.red("A base URL is required.\n"))
        return
      }
    }

    let apiKey = ""
    if (provider.id !== "ollama") {
      apiKey = (await this.rl.question(color.gray(`API key for ${providerId}: `))).trim()
      if (!apiKey && provider.id !== "custom") {
        this.out.write(color.red("No key entered. Cancelled.\n"))
        return
      }
    }

    // Persist to the global config and apply in-memory immediately.
    const path = saveProviderKey(providerId, apiKey || "ollama", baseURL)
    this.rt.providers.upsertProvider(providerId, {
      ...(baseURL ? { baseURL, sdk: "openai-compatible" } : {}),
      options: { apiKey: apiKey || "ollama" },
    })

    this.out.write(color.green(`✓ Connected ${providerId}. Saved to ${path}\n`))

    // Offer to set this provider's model as the active model.
    const suggested = this.suggestModel(providerId)
    if (suggested) {
      const useIt = (
        await this.rl.question(color.gray(`Use ${suggested} as your model? [Y/n] `))
      )
        .trim()
        .toLowerCase()
      if (useIt === "" || useIt === "y" || useIt === "yes") {
        this.applyModel(suggested)
      }
    }
    this.out.write("\n")
  }

  private suggestModel(providerId: string): string | null {
    if (providerId === "opencode") return "opencode/claude-sonnet-4-6"
    if (providerId === "anthropic") return "anthropic/claude-sonnet-4-5"
    if (providerId === "openai") return "openai/gpt-5.1"
    if (providerId === "google") return "google/gemini-3.1-pro"
    return null
  }

  /** Interactive model switch with an optional picker. */
  private async modelFlow(arg: string): Promise<void> {
    if (arg) {
      this.applyModel(arg)
      return
    }

    // Show models from connected providers.
    const providers = this.rt.providers.list().filter((p) => this.rt.providers.hasCredentials(p.id))
    if (providers.length === 0) {
      this.out.write(color.yellow("No connected providers. Use /connect first.\n"))
      return
    }

    const options: string[] = []
    this.out.write(color.bold("Available models:\n"))
    for (const p of providers) {
      const models = p.id === "opencode" ? ZEN_MODELS.map((m) => m.id) : p.models.map((m) => m.id)
      for (const m of models.slice(0, 8)) {
        const id = `${p.id}/${m}`
        options.push(id)
        this.out.write(`  ${color.cyan(String(options.length))}. ${id}\n`)
      }
    }

    const choice = (await this.rl.question(color.gray("Select a number, type an id, or Enter to cancel: "))).trim()
    if (!choice) return
    const asNum = Number(choice)
    const picked = !Number.isNaN(asNum) && options[asNum - 1] ? options[asNum - 1]! : choice
    this.applyModel(picked)
  }

  /** Apply a model selection in-memory and persist it. */
  private applyModel(model: string): void {
    this.rt.config.config.model = model
    const session = this.rt.sessions.get(this.chatSessionId)
    if (session) this.rt.sessions.setModel(session.id, model)
    const path = saveModel(model)
    this.out.write(color.green(`✓ Model set to ${model}. Saved to ${path}\n`))
  }

  /** Interactive permission setting. */
  private async permissionFlow(arg: string): Promise<void> {
    const [tool, level] = arg.split(/\s+/)
    if (!tool || !level || !["allow", "ask", "deny"].includes(level)) {
      this.out.write(color.yellow("Usage: /permission <tool> <allow|ask|deny>\n"))
      this.out.write(color.gray("  e.g. /permission bash ask\n"))
      return
    }
    this.rt.config.config.permission[tool] = level as "allow" | "ask" | "deny"
    const path = savePermission(tool, level as "allow" | "ask" | "deny", this.rt.config.projectRoot)
    this.out.write(color.green(`✓ permission.${tool} = ${level}. Saved to ${path}\n`))
  }

  /** Show the current effective configuration. */
  private showConfig(): void {
    const c = this.rt.config.config
    this.out.write(color.bold("\nCurrent configuration:\n"))
    this.out.write(`  ${color.gray("model:")}       ${c.model}\n`)
    this.out.write(`  ${color.gray("small_model:")} ${c.small_model ?? "(default)"}\n`)
    this.out.write(`  ${color.gray("agent:")}       ${this.rt.agents.current_().id}\n`)
    this.out.write(`  ${color.gray("providers:")}   ${Object.keys(c.provider).join(", ") || "(none)"}\n`)
    this.out.write(color.gray("  permissions:\n"))
    for (const [tool, level] of Object.entries(c.permission)) {
      const val = typeof level === "string" ? level : "(per-pattern rules)"
      this.out.write(`    ${tool}: ${val}\n`)
    }
    this.out.write(color.gray(`  config files: ${this.rt.config.sources.join(", ") || "(defaults only)"}\n\n`))
  }

  // ---------------------------------------------------------------------------
  // Agent loop wiring
  // ---------------------------------------------------------------------------

  private makeHandlers(): LoopHandlers {
    let streamed = false
    return {
      onTextChunk: (delta) => {
        streamed = true
        this.out.write(delta)
      },
      onText: (text) => {
        if (streamed) {
          this.out.write("\n")
          streamed = false
        } else {
          this.out.write("\n" + text + "\n")
        }
      },
      onToolStart: (name, args) => {
        if (streamed) {
          this.out.write("\n")
          streamed = false
        }
        const detail = this.summarizeArgs(name, args)
        this.out.write(color.gray(`  ⚙ ${name}${detail ? " " + detail : ""}\n`))
      },
      onToolEnd: (name, success, output) => {
        const mark = success ? color.green("✓") : color.red("✗")
        const preview = output.split("\n")[0]?.slice(0, 100) ?? ""
        this.out.write(color.gray(`  ${mark} ${name}: ${preview}\n`))
      },
      report: (message) => this.out.write(color.gray(`  ${message}\n`)),
      requestApproval: async (toolName, detail) => {
        const answer = (
          await this.rl.question(color.yellow(`  ? Allow ${toolName}: ${detail} [y/N] `))
        )
          .trim()
          .toLowerCase()
        return answer === "y" || answer === "yes"
      },
    }
  }

  private summarizeArgs(name: string, args: Record<string, unknown>): string {
    if (name === "bash") return color.dim(String(args["command"] ?? ""))
    if (args["path"]) return color.dim(String(args["path"]))
    if (args["pattern"]) return color.dim(String(args["pattern"]))
    if (args["url"]) return color.dim(String(args["url"]))
    return ""
  }

  private async handlePrompt(input: string): Promise<void> {
    const session = this.rt.sessions.get(this.chatSessionId)
    if (!session) return
    const agent = this.rt.agents.current_()

    // Ensure the active model has credentials before calling out.
    const providerId = (this.rt.config.config.model.split("/")[0] ?? "")
    if (!this.rt.providers.hasCredentials(providerId)) {
      this.out.write(color.yellow(`No API key for "${providerId}". Run /connect.\n`))
      return
    }

    // Auto-detect a spec-worthy build request and offer the spec flow.
    const detectMode = this.rt.config.config.spec.detect ?? "ask"
    if (detectMode !== "off" && detectSpecIntent(input).spec) {
      if (detectMode === "auto") {
        await this.runSpecAuto(input)
        return
      }
      const choice = await this.askSpecDecision()
      if (choice === "auto") {
        await this.runSpecAuto(input)
        return
      }
      if (choice === "questions") {
        await this.runClarify(input)
        return
      }
      // "build" (or aborted/empty) falls through to a normal turn.
    }

    try {
      const result = await this.rt.loop.run({
        sessionId: session.id,
        agent,
        userMessage: expandFileMentions(input, this.rt.config.projectRoot),
        handlers: this.makeHandlers(),
      })
      if (result.changes.length > 0) {
        this.out.write(
          color.gray(`\n  ${result.changes.length} file(s) changed · ${result.toolCalls} tool call(s)\n`),
        )
      }
    } catch (err) {
      this.out.write(color.red(`\nError: ${(err as Error).message}\n`))
    }
  }

  // ---------------------------------------------------------------------------
  // Spec auto-detection (line-mode: choose, or answer questions)
  // ---------------------------------------------------------------------------

  /** Ask how to handle a detected build request. Returns the chosen path. */
  private async askSpecDecision(): Promise<"questions" | "auto" | "build"> {
    this.out.write(color.bold("\n📋 This looks like something to build. How should I spec it?\n"))
    this.out.write(`  ${color.cyan("q")}. Answer a few clarifying questions (best specs)\n`)
    this.out.write(`  ${color.cyan("a")}. Auto — let Spectra pick sensible specs\n`)
    this.out.write(`  ${color.cyan("b")}. No spec — just build it now ${color.gray("(default)")}\n`)
    const raw = (await this.ask(color.gray("Choose [q/a/b]: "))) ?? ""
    const c = raw.trim().toLowerCase()
    if (c === "q" || c === "questions" || c === "1") return "questions"
    if (c === "a" || c === "auto" || c === "2") return "auto"
    return "build"
  }

  /** Auto mode: draft decisions, show them, let the user confirm / edit / cancel. */
  private async runSpecAuto(description: string): Promise<void> {
    this.out.write(color.gray("🤖 Auto spec: drafting decisions…\n"))
    let questions: ClarifyQuestion[] = []
    let answers: Clarification[] = []
    try {
      questions = await generateClarifyingQuestions(this.rt, description)
      answers = await autoAnswerQuestions(this.rt, description, questions)
    } catch {
      questions = []
      answers = []
    }
    if (answers.length === 0) {
      try {
        await runSpecWorkflow(this.rt, description, this.makeHandlers(), [])
      } catch (err) {
        this.out.write(color.red(`Spec error: ${(err as Error).message}\n`))
      }
      return
    }

    this.out.write(color.bold("\n🤖 Spectra chose these decisions:\n"))
    for (const a of answers) this.out.write(color.gray(`  • ${a.question} → ${a.answer}\n`))
    const raw = (await this.ask(color.gray("Generate with these? [Y]es / [e]dit / [n]o: "))) ?? ""
    const c = raw.trim().toLowerCase()
    if (c === "n" || c === "no") {
      this.out.write(color.gray("Cancelled.\n"))
      return
    }
    if (c === "e" || c === "edit") {
      await this.runClarify(description, questions)
      return
    }
    try {
      await runSpecWorkflow(this.rt, description, this.makeHandlers(), answers)
    } catch (err) {
      this.out.write(color.red(`Spec error: ${(err as Error).message}\n`))
    }
  }

  /** Questions mode: ask clarifying questions line by line (questions optional, prefetched). */
  private async runClarify(description: string, prefetched?: ClarifyQuestion[]): Promise<void> {
    let questions: ClarifyQuestion[] = prefetched ?? []
    if (!prefetched) {
      this.out.write(color.gray("Thinking of a few clarifying questions…\n"))
      try {
        questions = await generateClarifyingQuestions(this.rt, description)
      } catch {
        questions = []
      }
    }
    if (questions.length === 0) {
      this.out.write(color.gray("Couldn't form questions — generating the spec directly.\n"))
      try {
        await runSpecWorkflow(this.rt, description, this.makeHandlers(), [])
      } catch (err) {
        this.out.write(color.red(`Spec error: ${(err as Error).message}\n`))
      }
      return
    }

    const clarifications: Clarification[] = []
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!
      this.out.write(color.bold(`\n(${i + 1}/${questions.length}) ${q.question}\n`))
      q.options.forEach((o, j) => this.out.write(`  ${color.cyan(String(j + 1))}. ${o}\n`))
      const raw = await this.ask(color.gray("Pick a number, or type your own answer (Enter = first): "))
      if (raw === null) {
        this.out.write(color.gray("Cancelled.\n"))
        return
      }
      const trimmed = raw.trim()
      const n = Number(trimmed)
      let answer: string
      if (trimmed === "") answer = q.options[0] ?? ""
      else if (!Number.isNaN(n) && n >= 1 && n <= q.options.length) answer = q.options[n - 1]!
      else answer = trimmed
      clarifications.push({ question: q.question, answer })
    }

    try {
      await runSpecWorkflow(this.rt, description, this.makeHandlers(), clarifications)
    } catch (err) {
      this.out.write(color.red(`Spec error: ${(err as Error).message}\n`))
    }
  }

  // ---------------------------------------------------------------------------
  // Command dispatch
  // ---------------------------------------------------------------------------

  private async handleCommand(input: string): Promise<void> {
    const [cmd, ...rest] = input.slice(1).split(/\s+/)
    const arg = rest.join(" ")

    switch (cmd) {
      case "help":
        this.printHelp()
        break

      case "exit":
      case "quit":
        this.running = false
        this.out.write(color.gray("Goodbye.\n"))
        break

      case "connect":
        await this.connectFlow()
        break

      case "model":
        await this.modelFlow(arg)
        break

      case "permission":
      case "perm":
        await this.permissionFlow(arg)
        break

      case "supervise": {
        const a = arg.trim()
        const guarded = ["edit", "write", "bash"]
        if (a === "on" || a === "off") {
          const supervised = a === "on"
          const { saveAutoApprove } = await import("../config/writer.js")
          this.rt.config.config.autoApprove = !supervised
          saveAutoApprove(!supervised, this.rt.config.projectRoot)
          const level = supervised ? "ask" : "allow"
          for (const t of guarded) {
            this.rt.config.config.permission[t] = level as "allow" | "ask" | "deny"
            savePermission(t, level as "allow" | "ask" | "deny", this.rt.config.projectRoot)
          }
          this.out.write(
            color.green(
              supervised
                ? "🔒 Supervised mode ON — edits/writes/commands now ask for approval. (The Autopilot still runs unattended.)\n"
                : "🔓 Supervised mode OFF — tool actions auto-approve (deny rules still apply).\n",
            ),
          )
        } else {
          this.out.write(color.yellow(`Usage: /supervise <on|off>. Auto-approve is ${this.rt.config.config.autoApprove ? "ON" : "OFF"}.\n`))
        }
        break
      }

      case "config":
        this.showConfig()
        break

      case "agent": {
        if (arg) {
          const ok = this.rt.agents.setCurrent(arg)
          this.out.write(
            ok
              ? color.green(`Switched to agent: ${arg}\n`)
              : color.red(`Cannot switch to "${arg}" (not a primary agent).\n`),
          )
        } else {
          for (const a of this.rt.agents.all()) {
            const marker = a.id === this.rt.agents.current_().id ? color.green("●") : " "
            this.out.write(`  ${marker} ${color.bold(a.id)} ${color.gray("— " + a.description)}\n`)
          }
        }
        break
      }

      case "tab": {
        const next = this.rt.agents.cycle()
        this.out.write(color.green(`Switched to agent: ${next.id}\n`))
        break
      }

      case "ops":
      case "fix":
      case "doctor": {
        this.rt.agents.setCurrent("ops")
        this.out.write(color.green("🔧 OPS mode — I can diagnose and fix this machine: audio, wifi, drivers, services, packages.\n"))
        this.out.write(color.gray('Describe the problem, e.g. "no sound" or "wifi keeps dropping". Privileged/destructive steps ask first.\n'))
        break
      }

      case "models": {
        for (const p of this.rt.providers.list()) {
          const connected = this.rt.providers.hasCredentials(p.id) ? color.green(" ✓") : ""
          this.out.write(color.bold(`  ${p.name} (${p.id})${connected}\n`))
          for (const m of p.models.slice(0, 6)) {
            this.out.write(color.gray(`    ${p.id}/${m.id}\n`))
          }
        }
        break
      }

      case "spec": {
        if (!arg) {
          this.out.write(color.yellow("Usage: /spec <feature description>\n"))
          break
        }
        await runSpecWorkflow(this.rt, arg, this.makeHandlers())
        break
      }

      case "specmode": {
        const m = arg.trim()
        if (!["ask", "auto", "off"].includes(m)) {
          this.out.write(
            color.yellow(`Spec detection is "${this.rt.config.config.spec.detect ?? "ask"}". Usage: /specmode <ask|auto|off>\n`),
          )
          break
        }
        this.rt.config.config.spec.detect = m as "ask" | "auto" | "off"
        saveSpecDetect(m as "ask" | "auto" | "off", this.rt.config.projectRoot)
        this.out.write(color.green(`Spec auto-detection set to ${m}.\n`))
        break
      }

      case "run": {
        if (!arg) {
          this.out.write(color.yellow("Usage: /run <spec-id>\n"))
          break
        }
        await runSpecExecution(this.rt, arg, this.makeHandlers())
        break
      }

      case "undo": {
        const session = this.rt.sessions.get(this.chatSessionId)
        if (!session) break
        const snap = this.rt.sessions.popSnapshot(session.id)
        if (!snap) {
          this.out.write(color.gray("Nothing to undo.\n"))
          break
        }
        const { applyUndo } = await import("../workflow/undo.js")
        const count = applyUndo(this.rt.config.projectRoot, snap)
        this.out.write(color.green(`Reverted ${count} file change(s).\n`))
        break
      }

      case "sessions":
      case "resume":
      case "continue": {
        const sessions = this.rt.sessions.list()
        if (!sessions.length) {
          this.out.write(color.gray("No sessions yet. Type a message to start one.\n"))
          break
        }
        const a = arg.trim()
        if (a) {
          const target = /^\d+$/.test(a)
            ? sessions[Number(a) - 1]
            : sessions.find((s) => s.id === a || s.id.startsWith(a))
          if (!target) {
            this.out.write(color.yellow(`No session "${a}". Use /sessions to list them.\n`))
            break
          }
          this.chatSessionId = target.id
          this.rt.sessions.setCurrent(target.id)
          this.out.write(color.green(`⟲ Switched to session ${target.id} — ${target.title} (${target.messages.length} msgs).\n`))
          break
        }
        const cur = this.chatSessionId
        sessions.forEach((s, i) => {
          const mark = s.id === cur ? "●" : " "
          this.out.write(color.gray(`  ${mark} ${i + 1}. ${s.title} · ${s.messages.length} msgs · ${s.id}\n`))
        })
        this.out.write(color.gray("Use /resume <number> to switch, /new for a fresh one.\n"))
        break
      }

      case "projects": {
        const cur = this.rt.config.projectRoot
        const list = new ProjectManager().list()
        if (!list.length) this.out.write(color.gray("No projects registered yet.\n"))
        for (const p of list) {
          this.out.write(`  ${p.path === cur ? color.green("●") : " "} ${color.bold(p.name)} ${color.gray("— " + p.path)}\n`)
        }
        this.out.write(color.gray("Use /open <path> to switch.\n"))
        break
      }

      case "open": {
        const path = arg.trim()
        if (!path) {
          this.out.write(color.yellow("Usage: /open <path-to-project>\n"))
          break
        }
        const { resolve } = await import("node:path")
        const { existsSync, statSync } = await import("node:fs")
        const abs = resolve(this.rt.config.projectRoot, path)
        if (!existsSync(abs) || !statSync(abs).isDirectory()) {
          this.out.write(color.red(`Not a directory: ${abs}\n`))
          break
        }
        if (this.rt.autorun.running) {
          this.out.write(color.yellow("Stop the Autopilot before switching projects.\n"))
          break
        }
        const { reloadRuntime, connectIntegrations } = await import("../runtime.js")
        reloadRuntime(this.rt, { cwd: abs })
        new ProjectManager().add(abs)
        await connectIntegrations(this.rt)
        const prior = this.rt.sessions.resumable()
        if (prior) {
          this.chatSessionId = prior.id
          this.rt.sessions.setCurrent(prior.id)
          this.out.write(color.green(`✓ Opened ${this.rt.config.projectRoot} — resumed last session (${prior.messages.length} msgs).\n`))
        } else {
          const agent = this.rt.agents.current_()
          this.chatSessionId = this.rt.sessions.create(agent.id, agent.model ?? this.rt.config.config.model).id
          this.out.write(color.green(`✓ Opened ${this.rt.config.projectRoot} (new session).\n`))
        }
        break
      }

      case "clear":
      case "new": {
        const agent = this.rt.agents.current_()
        this.chatSessionId = this.rt.sessions.create(agent.id, agent.model ?? this.rt.config.config.model).id
        this.out.write(color.gray("Started a new session.\n"))
        break
      }

      default:
        this.out.write(color.red(`Unknown command: /${cmd}. Try /help.\n`))
    }
  }

  private printHelp(): void {
    const lines: [string, string][] = [
      ["/help", "Show this help"],
      ["/connect", "Connect a provider (interactive, saves your API key)"],
      ["/model [id]", "Switch model (interactive picker if no id given)"],
      ["/permission <t> <lvl>", "Set a tool permission (allow|ask|deny)"],
      ["/supervise <on|off>", "Approve edits/writes/commands before they run"],
      ["/config", "Show the current configuration"],
      ["/agent [id]", "List agents or switch to one"],
      ["/tab", "Cycle to the next primary agent"],
      ["/ops", "Fix THIS computer: audio, wifi, drivers, services (aliases: /fix, /doctor)"],
      ["/spec <desc>", "Generate a spec (requirements, design, tasks)"],
      ["/specmode <mode>", "Spec auto-detection: ask | auto | off"],
      ["/run <spec-id>", "Execute a spec's tasks in parallel waves"],
      ["/models", "List providers and models"],
      ["/new", "Start a FRESH session (alias: /clear)"],
      ["/sessions", "List sessions — then /resume <number> to switch"],
      ["/resume <n|id>", "Switch to a specific past session"],
      ["/projects", "List your projects"],
      ["/open <path>", "Switch to another project (resumes its session)"],
      ["/undo", "Revert the last set of file changes"],
      ["/exit", "Quit Spectra"],
    ]
    this.out.write("\n")
    for (const [c, desc] of lines) {
      this.out.write(`  ${color.cyan(c.padEnd(22))} ${color.gray(desc)}\n`)
    }
    this.out.write("\n")
  }
}
