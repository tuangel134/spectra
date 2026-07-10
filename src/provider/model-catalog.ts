/**
 * Live model discovery for OpenAI-compatible providers.
 *
 * A custom provider may expose a base URL, a full `/models` URL, or even a
 * `/chat/completions` URL copied from its documentation.  Normalize all three
 * forms and return useful diagnostics instead of silently pretending that the
 * provider has no models.
 */

interface ModelRow {
  id?: unknown
  name?: unknown
  model?: unknown
}

export interface ModelDiscoveryResult {
  models: string[]
  endpoint: string
  status?: number
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/** Normalize an OpenAI-compatible base URL without guessing whether `/v1` is required. */
export function normalizeOpenAIBaseURL(input: string): string {
  const value = input.trim()
  if (!value) throw new Error("Base URL is required")

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid base URL: ${value}`)
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL must use http:// or https://")
  }

  url.username = ""
  url.password = ""
  url.search = ""
  url.hash = ""

  let path = url.pathname.replace(/\/+$/, "")
  path = path.replace(/\/(?:chat\/completions|responses|models)$/i, "")
  url.pathname = path || "/"

  return url.toString().replace(/\/+$/, "")
}

export function openAIEndpoint(baseURL: string, endpoint: string): string {
  return `${normalizeOpenAIBaseURL(baseURL)}/${endpoint.replace(/^\/+/, "")}`
}

function rowsFromBody(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  if (!isRecord(body)) return []

  for (const key of ["data", "models", "result", "items"]) {
    const value = body[key]
    if (Array.isArray(value)) return value
    if (isRecord(value)) {
      for (const nestedKey of ["data", "models", "items"]) {
        if (Array.isArray(value[nestedKey])) return value[nestedKey] as unknown[]
      }
    }
  }
  return []
}

function modelId(row: unknown): string | null {
  if (typeof row === "string") return row.trim() || null
  if (!isRecord(row)) return null
  const candidate = (row as ModelRow).id ?? (row as ModelRow).model ?? (row as ModelRow).name
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null
}

/** Discover model ids and preserve the reason when discovery fails. */
export async function fetchLiveModelsDetailed(
  baseURL: string,
  apiKey: string | undefined,
  timeoutMs = 8000,
): Promise<ModelDiscoveryResult> {
  let endpoint: string
  try {
    endpoint = openAIEndpoint(baseURL, "models")
  } catch (error) {
    return { models: [], endpoint: baseURL, error: (error as Error).message }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = { Accept: "application/json" }
    if (apiKey?.trim()) headers["Authorization"] = `Bearer ${apiKey.trim()}`

    const response = await fetch(endpoint, { headers, signal: controller.signal })
    if (!response.ok) {
      return {
        models: [],
        endpoint,
        status: response.status,
        error: `GET /models returned HTTP ${response.status}`,
      }
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { models: [], endpoint, status: response.status, error: "GET /models did not return JSON" }
    }

    const models = rowsFromBody(body)
      .map(modelId)
      .filter((id): id is string => Boolean(id))

    const unique = [...new Set(models)]
    return unique.length
      ? { models: unique, endpoint, status: response.status }
      : { models: [], endpoint, status: response.status, error: "GET /models returned no recognizable model ids" }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? `GET /models timed out after ${timeoutMs}ms`
      : `GET /models failed: ${(error as Error).message}`
    return { models: [], endpoint, error: message }
  } finally {
    clearTimeout(timer)
  }
}

/** Backward-compatible helper used by ProviderRegistry. */
export async function fetchLiveModels(
  baseURL: string,
  apiKey: string | undefined,
  timeoutMs = 8000,
): Promise<string[]> {
  return (await fetchLiveModelsDetailed(baseURL, apiKey, timeoutMs)).models
}
