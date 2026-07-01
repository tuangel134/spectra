/**
 * Live free-model discovery.
 *
 * Instead of trusting a hardcoded list, Spectra fetches OpenCode's live model
 * catalog and keeps the set of free models (ids ending in `-free`) up to date.
 * The result is cached to `~/.config/spectra/free-models.json` and refreshed in
 * the background when stale, so new free models appear automatically and
 * removed ones disappear — without a Spectra update.
 *
 * If the network is unavailable, it falls back to the cached file, then to the
 * bundled list.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"

import { FREE_MODELS } from "./zen.js"

export interface FreeModel {
  id: string
  name: string
  context: number
}

const MODELS_ENDPOINT = "https://opencode.ai/zen/v1/models"
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000 // refresh at most once a day
const FETCH_TIMEOUT_MS = 8000

function cachePath(): string {
  return join(homedir(), ".config", "spectra", "free-models.json")
}

/** In-memory live list; null until loaded. */
let live: FreeModel[] | null = null

/** Turn a model id into a friendly display name. */
function nameFor(id: string): string {
  const base = id.replace(/-free$/, "")
  const pretty = base
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
  return `${pretty} (free)`
}

/** Load the cached file into memory (if present and parseable). */
function loadCache(): { models: FreeModel[]; fetchedAt: number } | null {
  const path = cachePath()
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as { models?: FreeModel[]; fetchedAt?: number }
    if (Array.isArray(data.models) && data.models.length > 0) {
      return { models: data.models, fetchedAt: data.fetchedAt ?? 0 }
    }
  } catch {
    /* ignore corrupt cache */
  }
  return null
}

function saveCache(models: FreeModel[]): void {
  const path = cachePath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ models, fetchedAt: Date.now() }, null, 2), "utf-8")
  } catch {
    /* best-effort */
  }
}

/**
 * The current free-model list: live (if fetched) → cached file → bundled.
 * Synchronous and safe to call anywhere.
 */
export function getFreeModels(): FreeModel[] {
  if (live) return live
  const cached = loadCache()
  if (cached) {
    live = cached.models
    return live
  }
  return FREE_MODELS
}

/**
 * Fetch the live catalog and update the free-model set. Best-effort: returns
 * the resulting list and never throws. Skips the network if the cache is fresh
 * (unless `force`).
 *
 * Crucially, the catalog's `-free` suffix is NOT authoritative — some models
 * keep the suffix after their free promotion ends. So we VERIFY each candidate
 * with a tiny keyless request and keep only those that actually respond.
 */
export async function refreshFreeModels(force = false): Promise<FreeModel[]> {
  const cached = loadCache()
  if (!force && cached && Date.now() - cached.fetchedAt < REFRESH_INTERVAL_MS) {
    live = cached.models
    return live
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(MODELS_ENDPOINT, { signal: controller.signal })
    if (!res.ok) throw new Error(`models endpoint ${res.status}`)
    const data = (await res.json()) as { data?: { id: string }[] }
    const candidates = (data.data ?? []).map((m) => m.id).filter((id) => /-free$/.test(id))
    if (candidates.length === 0) throw new Error("no free models in catalog")

    // Verify each candidate actually serves for free (no API key). Models whose
    // free promotion ended still appear with the -free suffix but return 401.
    const verified = await verifyFree(candidates)
    const usable = verified.length > 0 ? verified : candidates // fall back if probing blocked

    const bundledCtx = new Map(FREE_MODELS.map((m) => [m.id, m.context]))
    const models: FreeModel[] = usable.map((id) => ({
      id,
      name: nameFor(id),
      context: bundledCtx.get(id) ?? 128_000,
    }))
    live = models
    saveCache(models)
    return models
  } catch {
    live = cached?.models ?? FREE_MODELS
    return live
  } finally {
    clearTimeout(timer)
  }
}

/** Probe each model with a tiny keyless request; keep those that return 200. */
async function verifyFree(ids: string[]): Promise<string[]> {
  const endpoint = "https://opencode.ai/zen/v1/chat/completions"
  const checks = await Promise.allSettled(
    ids.map(async (id) => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 6000)
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: id, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
          signal: ctrl.signal,
        })
        return res.ok ? id : null
      } finally {
        clearTimeout(t)
      }
    }),
  )
  return checks
    .map((c) => (c.status === "fulfilled" ? c.value : null))
    .filter((id): id is string => id !== null)
}
