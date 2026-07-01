/**
 * Hook system.
 *
 * Event-driven automations loaded from .spectra/hooks/*.json. Hooks react to
 * lifecycle events (file changes, tool use, task execution) by running a shell
 * command or injecting a prompt for the agent.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { matchAnyGlob } from "../util/glob.js"
import { matchWildcard } from "../util/glob.js"
import { logger } from "../util/logger.js"

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

const TOOL_CATEGORIES: Record<string, string[]> = {
  read: ["read", "grep", "glob"],
  write: ["edit", "write", "apply_patch"],
  shell: ["bash"],
  web: ["webfetch", "websearch"],
  spec: ["spec"],
}

export class HookRegistry {
  private readonly hooks: HookDefinition[] = []
  private readonly projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
    this.load(projectRoot)
  }

  /** Re-scan the hook directories from disk (after a hook is added/removed). */
  reload(): void {
    this.hooks.length = 0
    this.load(this.projectRoot)
  }

  private load(projectRoot: string): void {
    const dirs = [
      join(projectRoot, ".spectra", "hooks"),
      join(projectRoot, ".opencode", "hooks"),
    ]
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
        (event.type === "fileEdited" ||
          event.type === "fileCreated" ||
          event.type === "fileDeleted") &&
        hook.when.patterns
      ) {
        return event.filePath ? matchAnyGlob(basename(event.filePath), hook.when.patterns) ||
          matchAnyGlob(event.filePath, hook.when.patterns) : false
      }

      if (
        (event.type === "preToolUse" || event.type === "postToolUse") &&
        hook.when.toolTypes
      ) {
        return hook.when.toolTypes.some((tt) => this.matchToolType(event.toolName ?? "", tt))
      }

      return true
    })
  }

  /** Run all hooks matching an event, returning their outcomes. */
  async fire(event: HookEvent, projectRoot: string): Promise<HookOutcome[]> {
    const outcomes: HookOutcome[] = []
    for (const hook of this.match(event)) {
      outcomes.push(this.execute(hook, event, projectRoot))
    }
    return outcomes
  }

  private execute(hook: HookDefinition, event: HookEvent, projectRoot: string): HookOutcome {
    if (hook.then.type === "askAgent") {
      return {
        hook: hook.name,
        action: "askAgent",
        success: true,
        output: hook.then.prompt ?? "",
      }
    }

    // runCommand
    const command = this.interpolate(hook.then.command ?? "", event)
    const shell = process.env["SHELL"] || "/bin/bash"
    const result = spawnSync(shell, ["-c", command], {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 60_000,
      env: {
        ...process.env,
        SPECTRA_EVENT_TYPE: event.type,
        SPECTRA_FILE_PATH: event.filePath ?? "",
        SPECTRA_TOOL_NAME: event.toolName ?? "",
      },
    })

    return {
      hook: hook.name,
      action: "runCommand",
      success: result.status === 0,
      output: ((result.stdout ?? "") + (result.stderr ?? "")).trim(),
    }
  }

  private interpolate(command: string, event: HookEvent): string {
    return command
      .replace(/\$FILE/g, event.filePath ?? "")
      .replace(/\$TOOL/g, event.toolName ?? "")
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
  const idx = path.lastIndexOf("/")
  return idx === -1 ? path : path.slice(idx + 1)
}
