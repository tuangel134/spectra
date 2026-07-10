import type { ModelProbeInput, ModelProbeResult } from "./types.js"

export function normalizeOpenAIBaseURL(input: string): string {
  const url = new URL(input.trim())
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http and https model endpoints are supported")
  url.pathname = url.pathname
    .replace(/\/(models|chat\/completions|responses)\/?$/i, "")
    .replace(/\/+$/, "") || "/"
  return url.toString().replace(/\/$/, "")
}

function extractModels(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return []
  const raw = payload as Record<string, unknown>
  const candidates = [raw["data"], raw["models"], raw["items"]]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    return candidate.map((item) => {
      if (typeof item === "string") return item
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>
        return String(row["id"] ?? row["name"] ?? row["model"] ?? "")
      }
      return ""
    }).filter(Boolean)
  }
  return []
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 5000): Promise<{ response: Response; payload: unknown; latencyMs: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    let payload: unknown = {}
    try { payload = text ? JSON.parse(text) : {} } catch { payload = { raw: text.slice(0, 500) } }
    return { response, payload, latencyMs: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

export async function probeOpenAICompatible(input: ModelProbeInput): Promise<ModelProbeResult> {
  const base = normalizeOpenAIBaseURL(input.baseURL)
  const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" }
  if (input.apiKey) headers["authorization"] = `Bearer ${input.apiKey}`
  const diagnostics: string[] = []
  const discovered = await fetchJson(`${base}/models`, { headers })
  const models = extractModels(discovered.payload)
  if (!discovered.response.ok) {
    const detail = discovered.payload && typeof discovered.payload === "object"
      ? JSON.stringify(discovered.payload).slice(0, 300)
      : String(discovered.payload)
    throw new Error(`Model discovery failed: HTTP ${discovered.response.status} ${detail}`)
  }
  diagnostics.push(`GET /models succeeded in ${discovered.latencyMs}ms`)
  const selectedModel = input.model || models[0]
  let streaming: boolean | null = null
  let toolCalling: boolean | null = null
  let structuredOutput: boolean | null = null
  let totalLatency = discovered.latencyMs

  if (input.deep && selectedModel) {
    const body = {
      model: selectedModel,
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: 4,
      temperature: 0,
      tools: [{ type: "function", function: { name: "spectra_probe", description: "Compatibility probe", parameters: { type: "object", properties: {}, additionalProperties: false } } }],
      tool_choice: "auto",
      response_format: { type: "json_object" },
    }
    const deep = await fetchJson(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) }, 12000)
    totalLatency += deep.latencyMs
    if (deep.response.ok) {
      const payload = deep.payload as Record<string, unknown>
      const choices = Array.isArray(payload["choices"]) ? payload["choices"] as Array<Record<string, unknown>> : []
      const message = choices[0]?.["message"] as Record<string, unknown> | undefined
      toolCalling = Array.isArray(message?.["tool_calls"])
      structuredOutput = typeof message?.["content"] === "string"
      streaming = true
      diagnostics.push(`POST /chat/completions succeeded in ${deep.latencyMs}ms`)
    } else {
      diagnostics.push(`Deep capability probe returned HTTP ${deep.response.status}; basic compatibility is still valid`)
      streaming = false
      toolCalling = false
      structuredOutput = false
    }
  }

  let score = 45
  if (models.length) score += 25
  if (input.deep && streaming) score += 10
  if (input.deep && toolCalling) score += 10
  if (input.deep && structuredOutput) score += 10
  return {
    ok: true,
    normalizedBaseURL: base,
    latencyMs: totalLatency,
    models,
    selectedModel,
    capabilities: { discovery: true, streaming, toolCalling, structuredOutput },
    compatibilityScore: Math.min(100, score),
    diagnostics,
  }
}
