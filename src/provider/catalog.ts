/**
 * Model catalog.
 *
 * A unified, current list of models across all providers used to populate the
 * model picker. Free and OpenCode models are listed statically; the live Zen
 * catalog can be fetched on demand. Each entry knows its provider so the picker
 * can prompt for an API key when one is missing.
 */

import { ZEN_MODELS, GO_MODELS } from "./zen.js"
import { getFreeModels } from "./free-models.js"
import { FREEBUFF_MODELS } from "./freebuff.js"

export interface CatalogEntry {
  /** Full id used in config: provider/model-id. */
  id: string
  providerId: string
  label: string
  /** Whether this model can be used without any API key. */
  free: boolean
}

/** Well-known direct-provider models (need the provider's own key). */
const ANTHROPIC = ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"]
const OPENAI = ["gpt-5.1", "gpt-5.1-codex", "gpt-5-mini"]
const GOOGLE = ["gemini-3.1-pro", "gemini-3-flash"]

/** Build the static catalog. Custom providers from config are added separately. */
export function staticCatalog(): CatalogEntry[] {
  const out: CatalogEntry[] = []

  for (const m of getFreeModels()) {
    out.push({ id: `free/${m.id}`, providerId: "free", label: `${m.name}`, free: true })
  }
  for (const m of FREEBUFF_MODELS) {
    out.push({ id: `freebuff/${m.id}`, providerId: "freebuff", label: `${m.name} (Freebuff)`, free: true })
  }
  for (const m of ZEN_MODELS) {
    out.push({ id: `opencode/${m.id}`, providerId: "opencode", label: m.name, free: false })
  }
  for (const m of GO_MODELS) {
    out.push({ id: `opencode-go/${m.id}`, providerId: "opencode-go", label: `${m.name} (Go)`, free: false })
  }
  for (const id of ANTHROPIC) {
    out.push({ id: `anthropic/${id}`, providerId: "anthropic", label: id, free: false })
  }
  for (const id of OPENAI) {
    out.push({ id: `openai/${id}`, providerId: "openai", label: id, free: false })
  }
  for (const id of GOOGLE) {
    out.push({ id: `google/${id}`, providerId: "google", label: id, free: false })
  }

  return out
}

/**
 * Fetch the live OpenCode Zen model list (no auth required for the listing).
 * Returns catalog entries for the `opencode` provider, or [] on failure.
 */
export async function fetchZenCatalog(timeoutMs = 8000): Promise<CatalogEntry[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch("https://opencode.ai/zen/v1/models", { signal: controller.signal })
    if (!res.ok) return []
    const data = (await res.json()) as { data?: { id?: string }[] }
    const models = (data.data ?? []).filter((m): m is { id: string } => typeof m.id === "string" && m.id.length > 0)
    return models.map((m) => {
      const isFree = /-free$/.test(m.id) || m.id.startsWith("free/")
      return {
        id: `${isFree ? "free" : "opencode"}/${m.id}`,
        providerId: isFree ? "free" : "opencode",
        label: m.id,
        free: isFree,
      }
    })
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
