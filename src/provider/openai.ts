/**
 * OpenAI Chat Completions provider.
 *
 * Compatible with api.openai.com, Ollama, OpenCode Zen /chat/completions,
 * and any OpenAI-compatible endpoint. Covers both the "openai" and
 * "openai-compatible" SDK families.
 */

import type { Provider, CompletionRequest, CompletionResult, ChatMessage, ToolCallRequest, SdkFamily } from "./types.js"
import { postJson, parseRetryAfter } from "./http.js"
import { ProviderError } from "./types.js"

interface OpenAIToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null | OpenAIContentPart[]
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

interface OpenAIResponse {
  choices: {
    message: {
      content: string | null
      tool_calls?: OpenAIToolCall[]
    }
    finish_reason: string
  }[]
  usage?: { prompt_tokens: number; completion_tokens: number }
}

export class OpenAIProvider implements Provider {
  constructor(readonly family: SdkFamily = "openai-compatible") {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const { model } = request
    const url = `${model.baseURL.replace(/\/$/, "")}/chat/completions`

    const messages = this.buildMessages(request.system, request.messages)

    const body: Record<string, unknown> = {
      model: model.modelId,
      messages,
    }

    if (request.temperature !== undefined) body["temperature"] = request.temperature
    if (request.topP !== undefined) body["top_p"] = request.topP
    if (request.maxTokens !== undefined) body["max_tokens"] = request.maxTokens

    if (request.tools.length > 0) {
      body["tools"] = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
      body["tool_choice"] = "auto"
    }

    const headers: Record<string, string> = { ...model.headers }
    if (model.apiKey) headers["authorization"] = `Bearer ${model.apiKey}`

    const response = await postJson<OpenAIResponse>({
      url,
      headers,
      body,
      timeout: model.timeout,
      signal: request.signal,
    })

    return this.parseResponse(response)
  }

  private buildMessages(system: string, messages: ChatMessage[]): OpenAIMessage[] {
    const result: OpenAIMessage[] = []

    if (system) {
      result.push({ role: "system", content: system })
    }

    for (const msg of messages) {
      if (msg.role === "system") {
        result.push({ role: "system", content: msg.content })
        continue
      }

      if (msg.role === "tool") {
        result.push({
          role: "tool",
          content: msg.content,
          tool_call_id: msg.toolCallId,
        })
        continue
      }

      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        result.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((c) => ({
            id: c.id,
            type: "function",
            function: {
              name: c.name,
              arguments: JSON.stringify(c.arguments),
            },
          })),
        })
        continue
      }

      if (msg.role === "user" && msg.images && msg.images.length > 0) {
        const parts: OpenAIContentPart[] = []
        if (msg.content) parts.push({ type: "text", text: msg.content })
        for (const img of msg.images) {
          parts.push({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.data}` } })
        }
        result.push({ role: "user", content: parts })
        continue
      }

      result.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
      })
    }

    return result
  }

  private parseResponse(response: OpenAIResponse): CompletionResult {
    const choice = response.choices?.[0]
    if (!choice) {
      return {
        content: "",
        toolCalls: [],
        stopReason: "error",
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    }

    const toolCalls: ToolCallRequest[] = (choice.message.tool_calls ?? []).map((tc) => {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function.arguments || "{}")
      } catch {
        args = {}
      }
      return { id: tc.id, name: tc.function.name, arguments: args }
    })

    const stopReason =
      choice.finish_reason === "tool_calls"
        ? "tool_use"
        : choice.finish_reason === "length"
          ? "length"
          : "stop"

    return {
      content: choice.message.content ?? "",
      toolCalls,
      stopReason,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    }
  }

  /**
   * Streaming completion (SSE) — yields text chunks to a callback.
   * Falls back to non-streaming `complete` if SSE parsing fails.
   */
  async completeStream(
    request: CompletionRequest,
    onChunk: (text: string) => void,
  ): Promise<CompletionResult> {
    const { model } = request
    const url = `${model.baseURL.replace(/\/$/, "")}/chat/completions`
    const messages = this.buildMessages(request.system, request.messages)
    const body: Record<string, unknown> = { model: model.modelId, messages, stream: true, stream_options: { include_usage: true } }
    if (request.temperature !== undefined) body["temperature"] = request.temperature
    if (request.topP !== undefined) body["top_p"] = request.topP
    if (request.maxTokens !== undefined) body["max_tokens"] = request.maxTokens
    if (request.tools.length > 0) {
      body["tools"] = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
      body["tool_choice"] = "auto"
    }
    const headers: Record<string, string> = { ...model.headers, "content-type": "application/json" }
    if (model.apiKey) headers["authorization"] = `Bearer ${model.apiKey}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), model.timeout)
    const onExternalAbort = (): void => controller.abort()
    if (request.signal) {
      if (request.signal.aborted) controller.abort()
      else request.signal.addEventListener("abort", onExternalAbort, { once: true })
    }
    let usage = { inputTokens: 0, outputTokens: 0 }
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal })
      if (!res.ok) {
        const errBody = await res.text().catch(() => "")
        throw new ProviderError(
          `Stream request failed (${res.status})`,
          res.status,
          errBody,
          parseRetryAfter(res.headers.get("retry-after")),
        )
      }
      // Fallback: some endpoints ignore `stream:true` and reply with a plain
      // JSON completion. Detect that and parse it normally so tool calls and
      // content are never silently dropped. Once we read the body here it is
      // consumed, so this branch must always return/throw (never fall through).
      const contentType = res.headers.get("content-type") ?? ""
      if (!contentType.includes("event-stream")) {
        const raw = await res.text().catch(() => "")
        try {
          const parsed = this.parseResponse(JSON.parse(raw) as OpenAIResponse)
          if (parsed.content) onChunk(parsed.content)
          return parsed
        } catch {
          throw new ProviderError(`Expected an SSE or JSON completion but got an unparseable body`, res.status, raw.slice(0, 400))
        }
      }
      const reader = res.body?.getReader()
      if (!reader) throw new ProviderError("No response body for stream")
      const dec = new TextDecoder()
      let buf = ""
      let content = ""
      const toolCalls: ToolCallRequest[] = []
      const argBuffers = new Map<number, { id: string; name: string; args: string }>()
      let finishReason = "stop"
      let done2 = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.startsWith("data:")) continue
          const payload = line.slice(5).trim()
          if (payload === "[DONE]") { done2 = true; break }
          try {
            const chunk = JSON.parse(payload) as {
              choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[]
              usage?: { prompt_tokens?: number; completion_tokens?: number }
              error?: { message?: string; type?: string } | string
            }
            // Mid-stream error frame (common on OpenAI-compatible gateways):
            // surface it so failover/retry can act instead of returning a
            // silently truncated "successful" completion.
            if (chunk.error) {
              const msg = typeof chunk.error === "string" ? chunk.error : chunk.error.message || chunk.error.type || "stream error"
              throw new ProviderError(`Stream error: ${msg}`)
            }
            if (chunk.usage) {
              usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 }
            }
            const delta = chunk.choices?.[0]?.delta
            if (delta?.content) { content += delta.content; onChunk(delta.content) }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!argBuffers.has(tc.index)) argBuffers.set(tc.index, { id: tc.id ?? "", name: tc.function?.name ?? "", args: "" })
                const ab = argBuffers.get(tc.index)!
                if (tc.id) ab.id = tc.id
                if (tc.function?.name) ab.name = tc.function.name
                if (tc.function?.arguments) ab.args += tc.function.arguments
              }
            }
            if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason
          } catch (e) { if (e instanceof ProviderError) throw e; /* skip malformed chunks */ }
        }
        if (done2) break
      }
      for (const [, ab] of argBuffers) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(ab.args || "{}") } catch {}
        toolCalls.push({ id: ab.id, name: ab.name, arguments: args })
      }
      const stopReason = finishReason === "tool_calls" ? "tool_use" : finishReason === "length" ? "length" : "stop"
      return { content, toolCalls, stopReason: stopReason as CompletionResult["stopReason"], usage }
    } finally {
      clearTimeout(timer)
      if (request.signal) request.signal.removeEventListener("abort", onExternalAbort)
    }
  }
}
