/**
 * Configuration type definitions for Spectra.
 */

export type PermissionLevel = "allow" | "ask" | "deny"

/**
 * A permission entry is either a flat level, or an object mapping
 * command/path patterns to levels (used by bash, edit, etc.).
 */
export type PermissionEntry = PermissionLevel | Record<string, PermissionLevel>

export type PermissionMap = Record<string, PermissionEntry>

export type AgentMode = "primary" | "subagent" | "all"

export interface AgentConfig {
  description: string
  mode?: AgentMode
  model?: string
  prompt?: string
  temperature?: number
  top_p?: number
  steps?: number
  permission?: PermissionMap
  hidden?: boolean
  color?: string
  disable?: boolean
}

export interface ProviderOptions {
  apiKey?: string
  baseURL?: string
  timeout?: number
  headers?: Record<string, string>
}

export interface ModelMeta {
  name?: string
  maxTokens?: number
  contextWindow?: number
  supportsImages?: boolean
  supportsTools?: boolean
}

export interface ProviderConfig {
  /** SDK family: anthropic, openai, openai-compatible, or zen (auto). */
  sdk?: "anthropic" | "openai" | "openai-compatible" | "zen"
  baseURL?: string
  options?: ProviderOptions
  models?: Record<string, ModelMeta>
}

export type ApprovalMode = "task" | "wave" | "all" | "none"

export interface SpecConfig {
  testAfterTask?: boolean
  maxParallelTasks?: number
  approvalMode?: ApprovalMode
  outputDir?: string
  /** How Spectra reacts to a detected build request: ask / auto / off. */
  detect?: "ask" | "auto" | "off"
}

export interface ServerConfig {
  port?: number
  hostname?: string
  cors?: string[]
}

export interface CompactionConfig {
  auto?: boolean
  prune?: boolean
  reserved?: number
}

export interface HeadroomConfig {
  /** Master switch for the context-compression layer. */
  enabled?: boolean
  /** Tool outputs below this token estimate are passed through untouched. */
  minTokens?: number
  /** Keep originals so the model can retrieve them (reversible / CCR). */
  reversible?: boolean
  /** Max originals to cache in memory (LRU-evicted). */
  maxStored?: number
  /** Persist cached originals to disk (survive eviction + restarts). */
  persist?: boolean
}

export interface AutorunConfigShape {
  enabled?: boolean
  reviewPasses?: number
  maxFixAttempts?: number
  stallThreshold?: number
  heartbeatStaleMs?: number
  maxTotalAttempts?: number
  verifyCommands?: string[]
  parallel?: boolean
  maxParallel?: number
  previewUrl?: string
}

/** One MCP server definition (Claude/OpenCode-compatible shape). */
export interface McpServerConfigShape {
  type?: "stdio" | "http" | "sse"
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  disabled?: boolean
  autoApprove?: string[]
}

export interface RoutingConfigShape {
  mode?: "manual" | "semi" | "auto" | "tiered"
  assignments?: Record<string, string>
  autochange?: {
    enabled?: boolean
    fallbacks?: string[]
  }
  tiers?: { easy?: string; medium?: string; hard?: string }
}

export interface SpectraConfig {
  model: string
  small_model?: string
  provider: Record<string, ProviderConfig>
  permission: PermissionMap
  agent: Record<string, AgentConfig>
  spec: Required<SpecConfig>
  server: Required<ServerConfig>
  compaction: Required<CompactionConfig>
  headroom: Required<HeadroomConfig>
  autorun: AutorunConfigShape
  mcp: Record<string, McpServerConfigShape>
  routing: RoutingConfigShape
  githubToken?: string
  autoupdate: boolean | "notify"
  /** Interactive auto-approval: when true, tool actions run without prompting. */
  autoApprove: boolean
  snapshot: boolean
  instructions: string[]
  shell?: string
  theme?: string
}

/** A partial config as read from disk before defaults are applied. */
export type RawConfig = Partial<{
  model: string
  small_model: string
  provider: Record<string, ProviderConfig>
  permission: PermissionMap
  agent: Record<string, AgentConfig>
  spec: SpecConfig
  server: ServerConfig
  compaction: CompactionConfig
  headroom: HeadroomConfig
  autorun: AutorunConfigShape
  mcp: Record<string, McpServerConfigShape>
  routing: RoutingConfigShape
  githubToken: string
  autoupdate: boolean | "notify"
  autoApprove: boolean
  snapshot: boolean
  instructions: string[]
  shell: string
  theme: string
}>
