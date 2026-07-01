/**
 * Permission evaluation.
 *
 * Resolves the effective permission level for a tool invocation by combining
 * agent-specific permissions (highest priority) with global permissions.
 * Bash commands and file paths are matched against pattern rules where the
 * last matching rule wins.
 */

import type { PermissionLevel, PermissionMap, PermissionEntry } from "../config/types.js"
import { matchWildcard } from "../util/glob.js"

/** Map a tool name to its permission group key. */
const TOOL_GROUP: Record<string, string> = {
  read: "read",
  edit: "edit",
  write: "edit",
  apply_patch: "edit",
  glob: "glob",
  grep: "grep",
  list: "list",
  bash: "bash",
  task: "task",
  todowrite: "todowrite",
  todoread: "todowrite",
  webfetch: "webfetch",
  websearch: "websearch",
  lsp: "lsp",
  skill: "skill",
  question: "question",
  spec: "spec",
}

function groupFor(toolName: string): string {
  return TOOL_GROUP[toolName] ?? toolName
}

/** Evaluate a pattern-rule object (e.g. bash command rules). Last match wins. */
function evaluatePatternRules(
  rules: Record<string, PermissionLevel>,
  value: string,
): PermissionLevel | null {
  let result: PermissionLevel | null = null
  for (const [pattern, level] of Object.entries(rules)) {
    if (matchWildcard(value, pattern)) {
      result = level
    }
  }
  return result
}

/** Check a single permission map for a decision. Returns null if no rule matches. */
function checkMap(
  map: PermissionMap | undefined,
  toolName: string,
  argValue?: string,
): PermissionLevel | null {
  if (!map) return null

  const group = groupFor(toolName)

  // Exact group / tool match.
  const entry: PermissionEntry | undefined = map[group] ?? map[toolName]
  if (entry !== undefined) {
    if (typeof entry === "string") return entry
    // Object rules: need an arg value (command or path) to match against.
    if (argValue !== undefined) {
      const matched = evaluatePatternRules(entry, argValue)
      if (matched !== null) return matched
    }
    // Fall back to a "*" rule inside the object.
    if (entry["*"]) return entry["*"]
  }

  // Wildcard tool patterns (e.g. "mymcp_*": "deny").
  for (const [pattern, value] of Object.entries(map)) {
    if (pattern === "*" || pattern === group || pattern === toolName) continue
    if (typeof value === "string" && matchWildcard(toolName, pattern)) {
      return value
    }
  }

  // Global wildcard.
  const star = map["*"]
  if (typeof star === "string") return star

  return null
}

export interface PermissionContext {
  /** Global permission map from config. */
  global: PermissionMap
  /** Agent-specific overrides. */
  agent?: PermissionMap
}

/**
 * Evaluate the effective permission for a tool call.
 *
 * @param toolName  Name of the tool (e.g. "bash", "edit").
 * @param ctx       Global and agent permission maps.
 * @param argValue  Optional command string or file path for pattern matching.
 * @returns         "allow" | "ask" | "deny" (defaults to "allow").
 */
export function evaluatePermission(
  toolName: string,
  ctx: PermissionContext,
  argValue?: string,
): PermissionLevel {
  const agentResult = checkMap(ctx.agent, toolName, argValue)
  if (agentResult !== null) return agentResult

  const globalResult = checkMap(ctx.global, toolName, argValue)
  if (globalResult !== null) return globalResult

  return "allow"
}
