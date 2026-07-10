/**
 * Hook system.
 *
 * Event-driven automations loaded from .spectra/hooks/*.json. Hooks react to
 * lifecycle events (file changes, tool use, task execution) by running a shell
 * command or injecting a prompt for the agent.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { matchAnyGlob, matchWildcard } from "../util/glob.js"
import { logger } from "../util/logger.js"
import { detachForGroupKill, IS_WINDOWS, killTree, shellFor } from "../util/platform.js"

export type HookEventType =
  | "fileEdited"
  | "fileCreated"
  | "fileDeleted"
  | "promptSubmit"
  | "agentStop"
  | "preToolUse"
  | "postToolUse"
  | "preTaskExecution"
  | "postTaskExecution"
  | "userTriggered"

export type HookActionType = "askAgent" | "runCommand"

export interface HookDefinition {
  name: string
  version: string
  description?: string
  when: {
    type: HookEventType
    patterns?: string[]
    toolTypes?: string[]
  }
  then: {
    type: HookActionType
    prompt?: string
    command?: string
  }
}

export interface HookEvent {
  type: HookEventType
  filePath?: string
  toolName?: string
  taskId?: number
  taskTitle?: string
  message?: string
}

export interface HookOutcome {
  hook: string
  action: HookActionType
  success: boolean
  /** For runCommand: combined output. For askAgent: the prompt to inject. */
  output: string
}

export interface HookRegistryOptions {
  /** Runtime Workspace Trust gate. Defaults to true for API/test compatibility. */
  canExecute?: () => boolean
  commandTimeoutMs?: number
  maxOutputBytes?: number
}

const TOOL_CATEGORIES: Record<string, string[]> = {
  read: ["read", "grep", "glob"],
  write: ["edit", "write", "apply_patch", "multiedit"],
  shell: ["bash"],
  web: ["webfetch", "websearch"],
  spec: ["spec"],
}

function quoteForShell(value: string): string {
  if (!IS_WINDOWS) return `'${value.replace(/'/g, `'"'"'`)}'`
  // cmd.exe: double quotes keep &, |, < and > inert. Escape percent expansion
  // and embedded quotes so a filename cannot become a second command.
  return `"${value.replace(/%/g, "%%").replace(/"/g, '""')}"`
}

export class HookRegistry {
  private readonly hooks: HookDefinition[] = []
  private readonly projectRoot: string
  private readonly canExecute: () => boolean
  private readonly commandTimeoutMs: number
  private readonly maxOutputBytes: number

  constructor(projectRoot: string, options: HookRegistryOptions = {}) {
    this.projectRoot = projectRoot
    this.canExecute = options.canExecute ?? (() => true)
    this.commandTimeoutMs = options.commandTimeoutMs ?? 60_000
    this.maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
    this.load(projectRoot)
  }

  /** Re-scan the hook directories from disk (after a hook is added/removed). */
  reload(): void {
    this.hooks.length = 0
    this.load(this.projectRoot)
  }

  private load(projectRoot: string): void {
    const dirs = [join(projectRoot, ".spectra", "hooks"), join(projectRoot, ".opencode", "hooks")]
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue
        try {
          const hook = JSON.parse(readFileSync(join(dir, file), "utf-8")) as HookDefinition
          if (this.isValid(hook)) this.hooks.push(hook)
          else logger.warn(`Skipping invalid hook: ${file}`)
        } catch {
          logger.warn(`Could not parse hook file: ${file}`)
        }
      }
    }
  }

  private isValid(hook: unknown): hook is HookDefinition {
    if (!hook || typeof hook !== "object") return false
    const h = hook as Record<string, unknown>
    if (typeof h["name"] !== "string") return false
    const when = h["when"] as Record<string, unknown> | undefined
    const then = h["then"] as Record<string, unknown> | undefined
    if (!when || typeof when["type"] !== "string") return false
    if (!then || typeof then["type"] !== "string") return false
    if (then["type"] === "runCommand" && typeof then["command"] !== "string") return false
    if (then["type"] === "askAgent" && typeof then["prompt"] !== "string") return false
    return true
  }

  list(): HookDefinition[] {
    return [...this.hooks]
  }

  /** Find hooks matching an event. */
  match(event: HookEvent): HookDefinition[] {
    return this.hooks.filter((hook) => {
      if (hook.when.type !== event.type) return false
      if (
        (event.type === "fileEdited" || event.type === "fileCreated" || event.type === "fileDeleted") &&
        hook.when.patterns
      ) {
        return event.filePath
          ? matchAnyGlob(basename(event.filePath), hook.when.patterns) ||
              matchAnyGlob(event.filePath, hook.when.patterns)
          : false
      }
      if ((event.type === "preToolUse" || event.type === "postToolUse") && hook.when.toolTypes) {
        return hook.when.toolTypes.some((tt) => this.matchToolType(event.toolName ?? "", tt))
      }
      return true
    })
  }

  /** Run all hooks matching an event, returning their outcomes. */
  async fire(event: HookEvent, projectRoot: string): Promise<HookOutcome[]> {
    const outcomes: HookOutcome[] = []
    for (const hook of this.match(event)) outcomes.push(await this.execute(hook, event, projectRoot))
    return outcomes
  }

  private async execute(
    hook: HookDefinition,
    event: HookEvent,
    projectRoot: string,
  ): Promise<HookOutcome> {
    if (!this.canExecute()) {
      return {
        hook: hook.name,
        action: hook.then.type,
        success: false,
        output: "Blocked by Workspace Trust. Trust this workspace before running project hooks.",
      }
    }

    if (hook.then.type === "askAgent") {
      return {
        hook: hook.name,
        action: "askAgent",
        success: true,
        output: hook.then.prompt ?? "",
      }
    }

    const command = this.interpolate(hook.then.command ?? "", event)
    const { file, args: shellArgs } = shellFor(command)

    return await new Promise<HookOutcome>((resolve) => {
      let output = ""
      let finished = false
      const child = spawn(file, shellArgs, {
        cwd: projectRoot,
        env: {
          ...process.env,
          SPECTRA_EVENT_TYPE: event.type,
          SPECTRA_FILE_PATH: event.filePath ?? "",
          SPECTRA_TOOL_NAME: event.toolName ?? "",
          SPECTRA_TASK_ID: String(event.taskId ?? ""),
        },
        stdio: ["ignore", "pipe", "pipe"],
        ...detachForGroupKill(),
      })

      const append = (chunk: Buffer): void => {
        if (Buffer.byteLength(output) >= this.maxOutputBytes) return
        output += chunk.toString("utf-8")
        if (Buffer.byteLength(output) > this.maxOutputBytes) {
          output = output.slice(0, this.maxOutputBytes) + "\n[output truncated]"
        }
      }
      child.stdout?.on("data", append)
      child.stderr?.on("data", append)

      let timer: ReturnType<typeof setTimeout> | undefined
      const done = (success: boolean, suffix = ""): void => {
        if (finished) return
        finished = true
        if (timer) clearTimeout(timer)
        resolve({
          hook: hook.name,
          action: "runCommand",
          success,
          output: (output + suffix).trim(),
        })
      }

      timer = setTimeout(() => {
        killTree(child)
        done(false, `\nHook timed out after ${this.commandTimeoutMs}ms.`)
      }, this.commandTimeoutMs)

      child.once("error", (error) => done(false, `\n${error.message}`))
      child.once("close", (code) => done(code === 0))
    })
  }

  private interpolate(command: string, event: HookEvent): string {
    const file = quoteForShell(event.filePath ?? "")
    const tool = quoteForShell(event.toolName ?? "")
    return command
      .replace(/(["'])\$FILE\1/g, file)
      .replace(/\$FILE/g, file)
      .replace(/(["'])\$TOOL\1/g, tool)
      .replace(/\$TOOL/g, tool)
      .replace(/\$TASK_ID/g, String(event.taskId ?? ""))
  }

  private matchToolType(toolName: string, typePattern: string): boolean {
    if (typePattern === "*") return true
    const category = TOOL_CATEGORIES[typePattern]
    if (category) return category.includes(toolName)
    try {
      return new RegExp(typePattern).test(toolName)
    } catch {
      return matchWildcard(toolName, typePattern)
    }
  }
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const idx = normalized.lastIndexOf("/")
  return idx === -1 ? normalized : normalized.slice(idx + 1)
}
