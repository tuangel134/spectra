/**
 * Agent registry.
 *
 * Merges built-in agents with user-defined agents from config, and tracks the
 * currently active primary agent for Tab-cycling.
 */

import type { SpectraConfig, AgentConfig } from "../config/types.js"
import type { Agent } from "./types.js"
import { BUILTIN_AGENTS, BASE_SYSTEM_PROMPT } from "./builtin.js"

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>()
  private current = "build"

  constructor(config: SpectraConfig) {
    for (const [id, def] of Object.entries(BUILTIN_AGENTS)) {
      this.agents.set(id, { id, ...def })
    }
    this.applyConfig(config.agent ?? {})
  }

  private applyConfig(configAgents: Record<string, AgentConfig>): void {
    for (const [id, cfg] of Object.entries(configAgents)) {
      const existing = this.agents.get(id)
      if (existing) {
        this.agents.set(id, {
          ...existing,
          description: cfg.description ?? existing.description,
          mode: cfg.mode ?? existing.mode,
          prompt: cfg.prompt ?? existing.prompt,
          model: cfg.model ?? existing.model,
          temperature: cfg.temperature ?? existing.temperature,
          topP: cfg.top_p ?? existing.topP,
          maxSteps: cfg.steps ?? existing.maxSteps,
          permission: { ...existing.permission, ...cfg.permission },
          allowedTools: cfg.tools ?? existing.allowedTools,
        hidden: cfg.hidden ?? existing.hidden,
          disabled: cfg.disable ?? existing.disabled,
          color: cfg.color ?? existing.color,
        })
      } else {
        this.agents.set(id, {
          id,
          description: cfg.description,
          mode: cfg.mode ?? "all",
          prompt: cfg.prompt ?? BASE_SYSTEM_PROMPT,
          model: cfg.model,
          temperature: cfg.temperature,
          topP: cfg.top_p,
          maxSteps: cfg.steps,
          permission: cfg.permission ?? {},
          hidden: cfg.hidden ?? false,
          disabled: cfg.disable ?? false,
          color: cfg.color,
          allowedTools: cfg.tools ?? null,
        })
      }
    }
  }

  get(id: string): Agent | undefined {
    const agent = this.agents.get(id)
    return agent && !agent.disabled ? agent : undefined
  }

  current_(): Agent {
    return this.agents.get(this.current)!
  }

  setCurrent(id: string): boolean {
    const agent = this.agents.get(id)
    if (!agent || agent.disabled || agent.mode === "subagent") return false
    this.current = id
    return true
  }

  /** Cycle to the next primary agent (Tab behavior). */
  cycle(): Agent {
    const primaries = this.primaries()
    if (primaries.length === 0) return this.current_()
    const idx = primaries.findIndex((a) => a.id === this.current)
    const next = primaries[(idx + 1) % primaries.length]!
    this.current = next.id
    return next
  }

  primaries(): Agent[] {
    return this.all().filter((a) => a.mode === "primary" || a.mode === "all")
  }

  subagents(): Agent[] {
    return this.all().filter((a) => a.mode === "subagent" || a.mode === "all")
  }

  all(): Agent[] {
    return Array.from(this.agents.values()).filter((a) => !a.disabled)
  }
}
