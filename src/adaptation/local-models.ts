import type { LocalRuntimeCandidate, LocalRuntimeResult } from "./types.js"

export const LOCAL_RUNTIME_CANDIDATES: LocalRuntimeCandidate[] = [
  { id: "ollama", name: "Ollama", baseURL: "http://127.0.0.1:11434", modelsURL: "http://127.0.0.1:11434/api/tags" },
  { id: "lm-studio", name: "LM Studio", baseURL: "http://127.0.0.1:1234/v1", modelsURL: "http://127.0.0.1:1234/v1/models" },
  { id: "llama-cpp", name: "llama.cpp", baseURL: "http://127.0.0.1:8080/v1", modelsURL: "http://127.0.0.1:8080/v1/models" },
  { id: "vllm", name: "vLLM", baseURL: "http://127.0.0.1:8000/v1", modelsURL: "http://127.0.0.1:8000/v1/models" },
]

function modelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return []
  const raw = payload as Record<string, unknown>
  const arrays = [raw["data"], raw["models"]]
  for (const candidate of arrays) {
    if (!Array.isArray(candidate)) continue
    return candidate.map((item) => {
      if (typeof item === "string") return item
      if (item && typeof item === "object") {
        const object = item as Record<string, unknown>
        return String(object["id"] ?? object["name"] ?? object["model"] ?? "")
      }
      return ""
    }).filter(Boolean)
  }
  return []
}

export async function detectLocalRuntimes(
  candidates: LocalRuntimeCandidate[] = LOCAL_RUNTIME_CANDIDATES,
  timeoutMs = 900,
): Promise<LocalRuntimeResult[]> {
  return Promise.all(candidates.map(async (candidate) => {
    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(candidate.modelsURL, { signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as unknown
      return { ...candidate, online: true, latencyMs: Date.now() - started, models: modelIds(payload) }
    } catch (error) {
      return { ...candidate, online: false, latencyMs: Date.now() - started, models: [], error: (error as Error).message }
    } finally {
      clearTimeout(timer)
    }
  }))
}
