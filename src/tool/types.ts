/**
 * Tool abstraction types.
 *
 * Tools are the actions the agent can take. Each tool declares a JSON Schema
 * for its parameters and an execute function.
 */

import type { PermissionLevel } from "../config/types.js"

export type ToolCategory = "read" | "write" | "shell" | "web" | "spec" | "meta"

/** Minimal view of Headroom needed by tools (recover compressed originals). */
export interface HeadroomRetriever {
  retrieve(ref: string): string | undefined
}

export interface ToolContext {
  /** Absolute path to the project root. */
  projectRoot: string
  /** Id of the agent invoking the tool. */
  agentId: string
  /** Ask the user to approve an action. Resolves to true if approved.
   *  `mandatory` marks a gate that must not be skipped by auto-approve (e.g. an
   *  operation escaping the project root). */
  requestApproval(toolName: string, detail: string, mandatory?: boolean): Promise<boolean>
  /** Evaluate the permission level for a tool + argument value. */
  permissionFor(toolName: string, argValue?: string): PermissionLevel
  /** Emit a progress/status line to the user. */
  report(message: string): void
  /** Headroom store for retrieving compressed originals, if enabled. */
  headroom?: HeadroomRetriever
}

export interface ToolResult {
  /** Human/LLM-readable output of the tool. */
  output: string
  /** Whether the tool succeeded. */
  success: boolean
  /** Optional structured metadata (e.g. files changed). */
  metadata?: Record<string, unknown>
}

export interface Tool {
  name: string
  description: string
  category: ToolCategory
  /** JSON Schema describing the parameters object. */
  parameters: Record<string, unknown>
  /** Whether this tool is available to subagents by default. */
  availableToSubagents?: boolean
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}

/** Helper to build a simple JSON Schema object. */
export function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  }
}
