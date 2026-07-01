import type { AgentMode, PermissionMap } from "../config/types.js"

export interface Agent {
  id: string
  description: string
  mode: AgentMode
  prompt: string
  model?: string
  temperature?: number
  topP?: number
  maxSteps?: number
  permission: PermissionMap
  hidden: boolean
  disabled: boolean
  color?: string
  /** List of allowed tool names, or null for all tools. */
  allowedTools: string[] | null
}
