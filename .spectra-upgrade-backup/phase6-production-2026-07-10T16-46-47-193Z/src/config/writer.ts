/**
 * Configuration writer.
 *
 * Persists configuration changes made interactively (e.g. /connect, /model)
 * back to a config file on disk. Reads the existing file as raw JSON (preserving
 * unknown keys), applies a mutation, and writes it back formatted.
 *
 * Writes target the global config (~/.config/spectra/spectra.jsonc) by default
 * so credentials are not committed to a project repo, but a project path can be
 * supplied explicitly.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs"
import { join, dirname } from "node:path"

import { parseJsonc } from "./loader.js"
import { configDir } from "../util/platform.js"
import type { RawConfig, SecurityProfile } from "./types.js";
import { SECURITY_PROFILES } from "../security/profiles.js"

/** Absolute path to the global config file. */
export function globalConfigPath(): string {
  return join(configDir(), "spectra.jsonc")
}

/** Absolute path to a project config file. */
export function projectConfigPath(projectRoot: string): string {
  return join(projectRoot, "spectra.jsonc")
}

/** Read a config file as a raw object, or return {} if it does not exist. */
export function readRawConfig(path: string): RawConfig {
  if (!existsSync(path)) return {}
  try {
    return (parseJsonc(readFileSync(path, "utf-8")) as RawConfig) ?? {}
  } catch {
    return {}
  }
}

/**
 * Apply a mutation to a config file and persist it.
 * The mutation receives the parsed raw config and mutates it in place.
 *
 * If the file exists but is currently unparseable (e.g. the user left a stray
 * comma mid-edit), we back it up to `<path>.bak` before overwriting so an
 * app-driven save never silently destroys existing credentials/settings.
 */
export function updateConfig(path: string, mutate: (config: RawConfig) => void): void {
  let config: RawConfig = {}
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf-8")
    try {
      config = (parseJsonc(raw) as RawConfig) ?? {}
    } catch {
      if (raw.trim()) {
        try {
          writeFileSync(path + ".bak", raw, "utf-8")
        } catch {
          /* best-effort backup */
        }
      }
    }
  }
  mutate(config)
  mkdirSync(dirname(path), { recursive: true })
  const header = "// Spectra configuration. Managed partly by the app; safe to edit.\n"
  // Atomic write: write to a temp file then rename, so a crash mid-write can
  // never leave a truncated/corrupt config behind.
  const tmp = path + ".tmp"
  writeFileSync(tmp, header + JSON.stringify(config, null, 2) + "\n", "utf-8")
  renameSync(tmp, path)
}

/**
 * Persist an API key for a provider to the global config.
 * Stores it inline so it is available without an environment variable.
 */
export function saveProviderKey(providerId: string, apiKey: string, baseURL?: string): string {
  const path = globalConfigPath()
  updateConfig(path, (config) => {
    config.provider ??= {}
    const existing = config.provider[providerId] ?? {}
    existing.options = { ...existing.options, apiKey }
    if (baseURL) existing.baseURL = baseURL
    config.provider[providerId] = existing
  })
  return path
}

/** Persist the selected default model to a config file. */
export function saveModel(model: string, target: "global" | string = "global"): string {
  const path = target === "global" ? globalConfigPath() : projectConfigPath(target)
  updateConfig(path, (config) => {
    config.model = model
  })
  return path
}

/** Persist a permission setting to the PROJECT config (security is per-project). */
export function savePermission(tool: string, level: "allow" | "ask" | "deny", projectRoot: string): string {
  const path = projectConfigPath(projectRoot)
  updateConfig(path, (config) => {
    config.permission ??= {}
    config.permission[tool] = level
  })
  return path
}

/** Remove a provider's stored credentials from the global config. */
export function removeProvider(providerId: string): string {
  const path = globalConfigPath()
  updateConfig(path, (config) => {
    if (config.provider) delete config.provider[providerId]
  })
  return path
}

/** Add or update a custom OpenAI-compatible provider in the global config. */
export function saveCustomProvider(opts: {
  id: string
  baseURL: string
  apiKey?: string
  model?: string
  models?: string[]
}): string {
  const path = globalConfigPath()
  updateConfig(path, (config) => {
    config.provider ??= {}
    const id = opts.id.trim()
    const existing = config.provider[id] ?? {}
    const apiKey = opts.apiKey?.trim()
    const options = { ...existing.options }
    if (apiKey) options.apiKey = apiKey

    const ids = [...new Set([...(opts.models ?? []), ...(opts.model ? [opts.model] : [])]
      .map((model) => model.trim())
      .filter(Boolean))]
    const models = { ...existing.models }
    for (const model of ids) models[model] = { ...models[model], name: models[model]?.name ?? model }

    config.provider[id] = {
      ...existing,
      sdk: "openai-compatible",
      baseURL: opts.baseURL.trim(),
      options,
      ...(Object.keys(models).length ? { models } : {}),
    }
  })
  return path
}

/** Persist the spec-detection mode (ask | auto | off) to the PROJECT config. */
export function saveSpecDetect(mode: "ask" | "auto" | "off", projectRoot: string): string {
  const path = projectConfigPath(projectRoot)
  updateConfig(path, (config) => {
    config.spec = { ...config.spec, detect: mode }
  })
  return path
}

/** Persist compaction settings to the PROJECT config. */
export function saveCompaction(patch: { auto?: boolean; reserved?: number }, projectRoot: string): string {
  const path = projectConfigPath(projectRoot)
  updateConfig(path, (config) => {
    config.compaction = { ...config.compaction, ...patch }
  })
  return path
}

/** Persist autorun (Full-Stack autopilot) settings to the PROJECT config. */
export function saveAutorun(patch: Record<string, unknown>, projectRoot: string): string {
  const path = projectConfigPath(projectRoot)
  updateConfig(path, (config) => {
    config.autorun = { ...config.autorun, ...patch }
  })
  return path
}

/** Persist the interactive auto-approve toggle to the PROJECT config. */
export function saveAutoApprove(value: boolean, projectRoot: string): string {
  const path = projectConfigPath(projectRoot)
  updateConfig(path, (config) => {
    config.autoApprove = value
  })
  return path
}

/** Persist Headroom (context-compression) settings to the PROJECT config. */
export function saveHeadroom(patch: {
  enabled?: boolean
  minTokens?: number
  reversible?: boolean
  maxStored?: number
  persist?: boolean
}, projectRoot: string): string {
  const path = projectConfigPath(projectRoot)
  updateConfig(path, (config) => {
    config.headroom = { ...config.headroom, ...patch }
  })
  return path
}

/** Persist model-routing settings (mode, per-task assignments, autochange, tiers) to the PROJECT config. */
export function saveRouting(patch: {
  mode?: "manual" | "semi" | "auto" | "tiered"
  assignments?: Record<string, string>
  autochange?: { enabled?: boolean; fallbacks?: string[] }
  tiers?: { easy?: string; medium?: string; hard?: string }
}, projectRoot: string): string {
  const path = projectConfigPath(projectRoot)
  updateConfig(path, (config) => {
    const current = config.routing ?? {}
    config.routing = {
      ...current,
      ...(patch.mode ? { mode: patch.mode } : {}),
      ...(patch.assignments ? { assignments: patch.assignments } : {}),
      ...(patch.autochange
        ? { autochange: { ...current.autochange, ...patch.autochange } }
        : {}),
      ...(patch.tiers ? { tiers: { ...current.tiers, ...patch.tiers } } : {}),
    }
  })
  return path
}

/** Persist a complete security profile to the PROJECT config. */
export function saveSecurityProfile(profile: SecurityProfile, projectRoot: string): string {
  const path = projectConfigPath(projectRoot)
  updateConfig(path, (config) => {
    config.security = { ...config.security, profile }
    if (profile === "legacy") return
    const preset = SECURITY_PROFILES[profile]
    config.permission = structuredClone(preset.permission)
    config.autoApprove = preset.autoApprove
    if (preset.autorun) config.autorun = { ...config.autorun, ...preset.autorun }
  })
  return path
}
