/**
 * Freebuff integration (Codebuff's free coding agent).
 *
 * Freebuff is ad-supported and free: "no API key, no credit card, it just
 * runs" — no login required. On first run the `freebuff` CLI auto-provisions an
 * anonymous token and saves it to ~/.config/manicode/credentials.json. Spectra
 * reads that token automatically.
 *
 * Freebuff's backend is not directly OpenAI-compatible, so requests go through
 * the community freebuff2api proxy (default http://localhost:8080/v1); point
 * `provider.freebuff.baseURL` at it.
 *
 * Availability: "full" mode in US/CA/UK/EU + select countries (all models);
 * "limited" mode elsewhere or via VPN (DeepSeek V4 Flash + MiMo 2.5, 5×1h
 * sessions/day).
 */

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

import { configDirFor } from "../util/platform.js"

/** Default OpenAI-compatible endpoint (the freebuff2api proxy). */
export const FREEBUFF_DEFAULT_BASE = "http://localhost:8080/v1"

/** Where the freebuff CLI stores its auto-provisioned (anonymous) token. */
function credentialsPath(): string {
  return join(configDirFor("manicode"), "credentials.json")
}

/**
 * Read the Freebuff token saved by the `freebuff` CLI, if present. This is
 * auto-provisioned on first run (no login), so it exists once you've launched
 * freebuff at least once. Returns null otherwise.
 */
export function detectFreebuffToken(): string | null {
  const path = credentialsPath()
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, { authToken?: string }>
    for (const profile of Object.values(data)) {
      if (profile && typeof profile.authToken === "string" && profile.authToken) {
        return profile.authToken
      }
    }
  } catch {
    /* ignore malformed credentials */
  }
  return null
}

/** Whether a Freebuff token is available (auto-provisioned by the CLI or env var). */
export function hasFreebuffToken(): boolean {
  return Boolean(detectFreebuffToken() || process.env["FREEBUFF_AUTH_TOKEN"])
}

/**
 * Freebuff's free models (from the official FAQ). Full mode exposes all of
 * them; limited mode is DeepSeek V4 Flash + MiMo 2.5. Bundled fallback —
 * overridable in config under provider.freebuff.models.
 */
export const FREEBUFF_MODELS: { id: string; name: string; context: number }[] = [
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro (free)", context: 128_000 },
  { id: "mimo-2.5-pro", name: "MiMo 2.5 Pro (free)", context: 128_000 },
  { id: "kimi-k2.6", name: "Kimi K2.6 (free)", context: 256_000 },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash (free)", context: 128_000 },
  { id: "mimo-2.5", name: "MiMo 2.5 (free)", context: 128_000 },
  { id: "minimax-m3", name: "MiniMax M3 (free)", context: 200_000 },
]
