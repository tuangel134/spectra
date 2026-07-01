/**
 * Configuration loader.
 *
 * Loads and merges spectra config from multiple sources in precedence order:
 *   1. Global:  ~/.config/spectra/spectra.jsonc
 *   2. Custom:  $SPECTRA_CONFIG (env var pointing to a file)
 *   3. Project: ./spectra.jsonc (walking up to the nearest git root)
 *
 * Later sources override earlier ones. Supports variable substitution:
 *   {env:VAR}   -> process.env.VAR
 *   {file:path} -> contents of the referenced file
 */

import { readFileSync, existsSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { homedir } from "node:os"

import type { RawConfig, SpectraConfig } from "./types.js"
import { DEFAULT_CONFIG } from "./defaults.js"
import { logger } from "../util/logger.js"

/** Strip // line comments and /* block *​/ comments from JSONC text. */
export function stripJsonComments(text: string): string {
  let out = ""
  let inString = false
  let inLineComment = false
  let inBlockComment = false
  let stringChar = ""

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    const next = text[i + 1]

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false
        out += char
      }
      continue
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false
        i++
      }
      continue
    }

    if (inString) {
      out += char
      if (char === "\\") {
        // Preserve escaped character verbatim.
        out += text[i + 1] ?? ""
        i++
      } else if (char === stringChar) {
        inString = false
      }
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      stringChar = char
      out += char
      continue
    }

    if (char === "/" && next === "/") {
      inLineComment = true
      i++
      continue
    }

    if (char === "/" && next === "*") {
      inBlockComment = true
      i++
      continue
    }

    out += char
  }

  return out
}

/**
 * Remove trailing commas which JSON.parse rejects but JSONC allows.
 * String-aware: never touches commas inside string literals (so a value like
 * "a, ]" is preserved intact).
 */
function stripTrailingCommas(text: string): string {
  let out = ""
  let inString = false
  let stringChar = ""
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (inString) {
      out += char
      if (char === "\\") {
        out += text[i + 1] ?? ""
        i++
      } else if (char === stringChar) {
        inString = false
      }
      continue
    }
    if (char === '"' || char === "'") {
      inString = true
      stringChar = char
      out += char
      continue
    }
    if (char === ",") {
      // Look ahead past whitespace: drop the comma only if the next non-space
      // token closes an object/array.
      let j = i + 1
      while (j < text.length && /\s/.test(text[j]!)) j++
      const nextTok = text[j]
      if (nextTok === "}" || nextTok === "]") continue // skip the trailing comma
    }
    out += char
  }
  return out
}

/** Parse a JSONC string into an object. */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripJsonComments(text)))
}

/** Resolve {env:VAR} and {file:path} substitutions inside a string. */
function resolveString(value: string, configDir: string): string {
  return value.replace(/\{(env|file):([^}]+)\}/g, (_match, type, ref) => {
    if (type === "env") {
      return process.env[ref] ?? ""
    }
    // file
    const filePath = ref.startsWith("~")
      ? join(homedir(), ref.slice(1))
      : ref.startsWith("/")
        ? ref
        : resolve(configDir, ref)
    try {
      return readFileSync(filePath, "utf-8").trim()
    } catch {
      return ""
    }
  })
}

/** Recursively resolve substitutions throughout a config object. */
function resolveVariables<T>(obj: T, configDir: string): T {
  if (typeof obj === "string") {
    return resolveString(obj, configDir) as unknown as T
  }
  if (Array.isArray(obj)) {
    return obj.map((v) => resolveVariables(v, configDir)) as unknown as T
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      result[key] = resolveVariables(val, configDir)
    }
    return result as T
  }
  return obj
}

/** Deep-merge `source` into `target`, returning a new object. */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) }
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const existing = result[key]
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      result[key] = deepMerge(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else if (value !== undefined) {
      result[key] = value
    }
  }
  return result as T
}

/** Walk up from `start` until a directory containing `.git` is found. */
function findProjectRoot(start: string): string {
  let dir = resolve(start)
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir
    if (existsSync(join(dir, "spectra.jsonc")) || existsSync(join(dir, "spectra.json")))
      return dir
    const parent = dirname(dir)
    if (parent === dir) return resolve(start)
    dir = parent
  }
}

function readConfigFile(path: string): RawConfig | null {
  if (!existsSync(path)) return null
  const raw = readFileSync(path, "utf-8")
  let parsed: RawConfig
  try {
    parsed = parseJsonc(raw) as RawConfig
  } catch (err) {
    // A malformed config must never crash startup. Warn and skip this layer so
    // the rest of the config chain (and defaults) still apply.
    logger.warn(`Ignoring malformed config at ${path}: ${(err as Error).message}`)
    return null
  }
  return resolveVariables(parsed, dirname(path))
}

export interface LoadConfigOptions {
  /** Directory to treat as the project (defaults to cwd). */
  cwd?: string
  /** Explicit config path override. */
  configPath?: string
}

export interface LoadedConfig {
  config: SpectraConfig
  projectRoot: string
  sources: string[]
}

/** Load and merge configuration from all sources. */
export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const cwd = options.cwd ?? process.cwd()
  const projectRoot = findProjectRoot(cwd)
  const sources: string[] = []

  let merged: SpectraConfig = structuredClone(DEFAULT_CONFIG)

  // 1. Global config
  const globalPath = join(homedir(), ".config", "spectra", "spectra.jsonc")
  const globalCfg = readConfigFile(globalPath)
  if (globalCfg) {
    merged = deepMerge(merged, globalCfg as Partial<SpectraConfig>)
    sources.push(globalPath)
  }

  // 2. Custom config from env var
  const envPath = options.configPath ?? process.env["SPECTRA_CONFIG"]
  if (envPath) {
    const envCfg = readConfigFile(envPath)
    if (envCfg) {
      merged = deepMerge(merged, envCfg as Partial<SpectraConfig>)
      sources.push(envPath)
    }
  }

  // 3. Project config
  for (const name of ["spectra.jsonc", "spectra.json"]) {
    const projectPath = join(projectRoot, name)
    const projectCfg = readConfigFile(projectPath)
    if (projectCfg) {
      merged = deepMerge(merged, projectCfg as Partial<SpectraConfig>)
      sources.push(projectPath)
      break
    }
  }

  return { config: merged, projectRoot, sources }
}
