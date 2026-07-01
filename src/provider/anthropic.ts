/**
 * Anthropic Messages API provider.
 * Compatible with api.anthropic.com and the OpenCode Zen /messages endpoint.
 */

import type {
  Provider,
  CompletionRequest,
  CompletionResult,
  ChatMessage,
  ToolCallRequest,
} from "./types.js"
import { ProviderError } from "./types.js"
import { postJson, parseRetryAfter } from "./http.js"

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
  source?: { type: "base64"; media_type: string; data: string }
}

interface AnthropicMessage {
  role: "user" | "assistant"
  content: AnthropicContentBlock[] | string
}

interface AnthropicResponse {
  content: AnthropicContentBlock[]
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}

export class AnthropicProvider implements Provider {
  readonly family = "anthropic" as const

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const { model } = request
    const url = `${model.baseURL.replace(/\/$/, "")}/messages`

    const messages = this.buildMessages(request.messages)

    const body: Record<string, unknown> = {
      model: model.modelId,
      max_tokens: request.maxTokens ?? model.info.maxTokens ?? 8192,
      // Mark the system prompt as cacheable so repeated turns hit the provider's
      // prompt cache (lower latency + cost). Falls back gracefully if ignored.
      system: request.system
        ? [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }]
        : undefined,
      messages,
    }

    if (request.temperature !== undefined) body["temperature"] = request.temperature
    if (request.topP !== undefined) body["top_p"] = request.topP

    if (request.tools.length > 0) {
      body["tools"] = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }))
    }

    const headers: Record<string, string> = {
      "anthropic-version": "2023-06-01",
      ...model.headers,
    }
    if (model.apiKey) {
      headers["x-api-key"] = model.apiKey
      headers["authorization"] = `Bearer ${model.apiKey}`
    }

    const response = await postJson<AnthropicResponse>({
      url,
      headers,
      body,
      timeout: model.timeout,
      signal: request.signal,
    })

    return this.parseResponse(response)
  }

  /** Streaming completion (SSE) over the Anthropic Messages API. */
  async completeStream(request: CompletionRequest, onChunk: (text: string) => void): Promise<CompletionResult> {
    const { model } = request
    const url = `${model.baseURL.replace(/\/$/, "")}/messages`
    const body: Record<string, unknown> = {
      model: model.modelId,
      max_tokens: request.maxTokens ?? model.info.maxTokens ?? 8192,
      system: request.system ? [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }] : undefined,
      messages: this.buildMessages(request.messages),
      stream: true,
    }
    if (request.temperature !== undefined) body["temperature"] = request.temperature
    if (request.topP !== undefined) body["top_p"] = request.topP
    if (request.tools.length > 0) {
      body["tools"] = request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
    }
    const headers: Record<string, string> = { "anthropic-version": "2023-06-01", "content-type": "application/json", ...model.headers }
    if (model.apiKey) {
      headers["x-api-key"] = model.apiKey
      headers["authorization"] = `Bearer ${model.apiKey}`
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), model.timeout)
    const onExternalAbort = (): void => controller.abort()
    if (request.signal) {
      if (request.signal.aborted) controller.abort()
      else request.signal.addEventListener("abort", onExternalAbort, { once: true })
    }
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal })
      if (!res.ok) {
        const errBody = await res.text().catch(() => "")
        throw new ProviderError(`Stream request failed (${res.status})`, res.status, errBody, parseRetryAfter(res.headers.get("retry-after")))
      }
      // Fallback: endpoint ignored `stream:true` and returned a plain JSON
      // message. Parse it normally so content/tool calls are not dropped.
      // Reading the body consumes it, so always return/throw here.
      const contentType = res.headers.get("content-type") ?? ""
      if (!contentType.includes("event-stream")) {
        const raw = await res.text().catch(() => "")
        try {
          const parsed = this.parseResponse(JSON.parse(raw) as AnthropicResponse)
          if (parsed.content) onChunk(parsed.content)
          return parsed
        } catch {
          throw new ProviderError(`Expected an SSE or JSON message but got an unparseable body`, res.status, raw.slice(0, 400))
        }
      }
      const reader = res.body?.getReader()
      if (!reader) throw new ProviderError("No response body for stream")
      const dec = new TextDecoder()
      let buf = ""
      let content = ""
      let stopReason = "stop"
      const usage = { inputTokens: 0, outputTokens: 0 }
      const blocks = new Map<number, { type: "text" | "tool_use"; id?: string; name?: string; json: string }>()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.startsWith("data:")) continue
          const payload = line.slice(5).trim()
          if (!payload) continue
          let ev: {
            type?: string
            index?: number
            message?: { usage?: { input_tokens?: number } }
            content_block?: { type?: string; id?: string; name?: string }
            delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
            usage?: { output_tokens?: number }
          }
          try {
            ev = JSON.parse(payload)
          } catch {
            continue
          }
          if (ev.type === "error") {
            const e = (ev as { error?: { message?: string; type?: string } }).error
            throw new ProviderError(`Stream error: ${e?.message || e?.type || "anthropic stream error"}`)
          }
          if (ev.type === "message_start") usage.inputTokens = ev.message?.usage?.input_tokens ?? 0
          else if (ev.type === "content_block_start" && ev.index !== undefined) {
            const cb = ev.content_block ?? {}
            blocks.set(ev.index, { type: cb.type === "tool_use" ? "tool_use" : "text", id: cb.id, name: cb.name, json: "" })
          } else if (ev.type === "content_block_delta" && ev.index !== undefined) {
            const d = ev.delta ?? {}
            if (d.type === "text_delta" && typeof d.text === "string") {
              content += d.text
              onChunk(d.text)
            } else if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
              const b = blocks.get(ev.index)
              if (b) b.json += d.partial_json
            }
          } else if (ev.type === "message_delta") {
            if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason
            if (ev.usage?.output_tokens) usage.outputTokens = ev.usage.output_tokens
          }
        }
      }

      const toolCalls: ToolCallRequest[] = []
      for (const [, b] of blocks) {
        if (b.type === "tool_use" && b.id && b.name) {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(b.json || "{}")
          } catch {
            args = {}
          }
          toolCalls.push({ id: b.id, name: b.name, arguments: args })
        }
      }
      const sr = stopReason === "tool_use" ? "tool_use" : stopReason === "max_tokens" ? "length" : "stop"
      return { content, toolCalls, stopReason: sr as CompletionResult["stopReason"], usage }
    } finally {
      clearTimeout(timer)
      if (request.signal) request.signal.removeEventListener("abort", onExternalAbort)
    }
  }

  private buildMessages(messages: ChatMessage[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = []

    for (const msg of messages) {
      if (msg.role === "system") continue // handled via top-level system

      if (msg.role === "tool") {
        // Tool results are sent as user messages with tool_result blocks.
        result.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId,
              content: msg.content,
            },
          ],
        })
        continue
      }

      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        const blocks: AnthropicContentBlock[] = []
        if (msg.content) blocks.push({ type: "text", text: msg.content })
        for (const call of msg.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments,
          })
        }
        result.push({ role: "assistant", content: blocks })
        continue
      }

      if (msg.role === "user" && msg.images && msg.images.length > 0) {
        const blocks: AnthropicContentBlock[] = []
        if (msg.content) blocks.push({ type: "text", text: msg.content })
        for (const img of msg.images) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: img.mediaType, data: img.data },
          })
        }
        result.push({ role: "user", content: blocks })
        continue
      }

      result.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
      })
    }

    return result
  }

  private parseResponse(response: AnthropicResponse): CompletionResult {
    let content = ""
    const toolCalls: ToolCallRequest[] = []

    for (const block of response.content) {
      if (block.type === "text" && block.text) {
        content += block.text
      } else if (block.type === "tool_use" && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input ?? {},
        })
      }
    }

    const stopReason =
      response.stop_reason === "tool_use"
        ? "tool_use"
        : response.stop_reason === "max_tokens"
          ? "length"
          : "stop"

    return {
      content,
      toolCalls,
      stopReason,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    }
  }
}
