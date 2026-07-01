/**
 * Live model catalog fetch for OpenAI-compatible providers.
 *
 * Hits `GET {baseURL}/models` so Spectra can show the provider's CURRENT models
 * instead of a hardcoded list that goes stale. Best-effort and bounded by a
 * short timeout — callers fall back to whatever they already have.
 */

interface ModelsResponse {
  data?: { id?: string }[]
  models?: { id?: string; name?: string }[]
}

/**
 * Return the list of model ids advertised by an OpenAI-compatible endpoint.
 * Returns [] on any error (offline, auth, non-OpenAI shape).
 */
export async function fetchLiveModels(
  baseURL: string,
  apiKey: string | undefined,
  timeoutMs = 8000,
): Promise<string[]> {
  const url = `${baseURL.replace(/\/+$/, "")}/models`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = { Accept: "application/json" }
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) return []
    const body = (await res.json()) as ModelsResponse
    const rows = body.data ?? body.models ?? []
    const ids = rows
      .map((r) => r.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
    // De-duplicate, keep provider order (usually newest-first or alphabetical).
    return [...new Set(ids)]
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
