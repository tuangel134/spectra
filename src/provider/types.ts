/**
 * Provider abstraction types.
 *
 * Spectra normalizes all LLM providers to a common message/tool interface so
 * the agent loop is provider-agnostic.
 */

export type SdkFamily = "anthropic" | "openai" | "openai-compatible"

export interface ModelInfo {
  id: string
  name: string
  providerId: string
  contextWindow?: number
  maxTokens?: number
  supportsTools: boolean
  supportsImages: boolean
}

export interface ResolvedModel {
  providerId: string
  modelId: string
  baseURL: string
  apiKey: string | undefined
  sdk: SdkFamily
  headers: Record<string, string>
  timeout: number
  info: ModelInfo
}

/** An image attached to a user message (base64-encoded). */
export interface ImagePart {
  /** MIME type, e.g. "image/png", "image/jpeg". */
  mediaType: string
  /** Base64-encoded image data (no data: prefix). */
  data: string
}

/** A normalized chat message used across providers. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  /** Tool calls requested by the assistant. */
  toolCalls?: ToolCallRequest[]
  /** For role "tool": the id of the call this responds to. */
  toolCallId?: string
  /** Images attached to a user message (multimodal input). */
  images?: ImagePart[]
}

export interface ToolCallRequest {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/** A tool definition advertised to the model. */
export interface ToolSchema {
  name: string
  description: string
  /** JSON Schema for the tool parameters. */
  parameters: Record<string, unknown>
}

export interface CompletionRequest {
  model: ResolvedModel
  system: string
  messages: ChatMessage[]
  tools: ToolSchema[]
  temperature?: number
  topP?: number
  maxTokens?: number
  /** Optional external abort signal (turn cancellation). */
  signal?: AbortSignal
}

export interface CompletionResult {
  /** Assistant text content (may be empty if only tool calls). */
  content: string
  /** Tool calls the model wants to execute. */
  toolCalls: ToolCallRequest[]
  /** Why generation stopped. */
  stopReason: "stop" | "tool_use" | "length" | "error"
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

/** A provider knows how to turn a CompletionRequest into a CompletionResult. */
export interface Provider {
  readonly family: SdkFamily
  complete(request: CompletionRequest): Promise<CompletionResult>
  /** Optional streaming variant: emits text deltas via onChunk as they arrive. */
  completeStream?(request: CompletionRequest, onChunk: (text: string) => void): Promise<CompletionResult>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
    /** Seconds to wait before retrying, parsed from a `retry-after` header. */
    readonly retryAfter?: number,
  ) {
    super(message)
    this.name = "ProviderError"
  }
}
