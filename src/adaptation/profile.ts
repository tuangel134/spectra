import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { UserAdaptationProfile } from "./types.js"

export function defaultAdaptationProfile(): UserAdaptationProfile {
  return {
    schemaVersion: 1,
    onboardingCompleted: false,
    experience: "intermediate",
    autonomy: "balanced",
    language: "es",
    explanation: "concise",
    privacy: "hybrid",
    modelStrategy: "balanced",
    accessibility: {
      fontScale: 1,
      density: "comfortable",
      highContrast: false,
      reducedMotion: false,
      colorVision: "default",
    },
    budgets: { sessionUsd: null, dailyUsd: null },
    updatedAt: Date.now(),
  }
}

function configHome(): string {
  if (process.platform === "win32") return process.env["APPDATA"] ?? path.join(os.homedir(), "AppData", "Roaming")
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support")
  return process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config")
}

export function adaptationProfilePath(): string {
  return path.join(configHome(), "spectra", "user-profile.json")
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function normalizeAdaptationProfile(input: unknown, base = defaultAdaptationProfile()): UserAdaptationProfile {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {}
  const accessibility = raw["accessibility"] && typeof raw["accessibility"] === "object"
    ? raw["accessibility"] as Record<string, unknown>
    : {}
  const budgets = raw["budgets"] && typeof raw["budgets"] === "object"
    ? raw["budgets"] as Record<string, unknown>
    : {}
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === "string" && allowed.includes(value as T) ? value as T : fallback
  const scale = Number(accessibility["fontScale"])
  return {
    schemaVersion: 1,
    onboardingCompleted: typeof raw["onboardingCompleted"] === "boolean" ? raw["onboardingCompleted"] : base.onboardingCompleted,
    experience: oneOf(raw["experience"], ["beginner", "intermediate", "advanced"] as const, base.experience),
    autonomy: oneOf(raw["autonomy"], ["supervised", "balanced", "autonomous"] as const, base.autonomy),
    language: oneOf(raw["language"], ["es", "en"] as const, base.language),
    explanation: oneOf(raw["explanation"], ["guided", "concise", "detailed"] as const, base.explanation),
    privacy: oneOf(raw["privacy"], ["cloud", "hybrid", "local"] as const, base.privacy),
    modelStrategy: oneOf(raw["modelStrategy"], ["quality", "balanced", "economy", "local-first"] as const, base.modelStrategy),
    accessibility: {
      fontScale: Number.isFinite(scale) ? Math.min(1.6, Math.max(0.8, scale)) : base.accessibility.fontScale,
      density: oneOf(accessibility["density"], ["comfortable", "compact"] as const, base.accessibility.density),
      highContrast: typeof accessibility["highContrast"] === "boolean" ? accessibility["highContrast"] : base.accessibility.highContrast,
      reducedMotion: typeof accessibility["reducedMotion"] === "boolean" ? accessibility["reducedMotion"] : base.accessibility.reducedMotion,
      colorVision: oneOf(accessibility["colorVision"], ["default", "deuteranopia", "protanopia", "tritanopia"] as const, base.accessibility.colorVision),
    },
    budgets: {
      sessionUsd: numberOrNull(budgets["sessionUsd"] ?? base.budgets.sessionUsd),
      dailyUsd: numberOrNull(budgets["dailyUsd"] ?? base.budgets.dailyUsd),
    },
    updatedAt: Date.now(),
  }
}

export class UserAdaptationStore {
  constructor(readonly file = adaptationProfilePath()) {}

  load(): UserAdaptationProfile {
    try {
      return normalizeAdaptationProfile(JSON.parse(fs.readFileSync(this.file, "utf8")))
    } catch {
      return defaultAdaptationProfile()
    }
  }

  save(input: unknown): UserAdaptationProfile {
    const next = normalizeAdaptationProfile(input, this.load())
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, this.file)
    try { fs.chmodSync(this.file, 0o600) } catch { /* Windows */ }
    return next
  }

  export(): { kind: "spectra-user-profile"; version: 1; profile: UserAdaptationProfile } {
    return { kind: "spectra-user-profile", version: 1, profile: this.load() }
  }

  import(input: unknown): UserAdaptationProfile {
    const raw = input && typeof input === "object" ? input as Record<string, unknown> : {}
    if (raw["kind"] !== "spectra-user-profile" || raw["version"] !== 1) throw new Error("Unsupported Spectra profile file")
    return this.save(raw["profile"])
  }
}

export function recommendationsFor(profile: UserAdaptationProfile): Record<string, unknown> {
  return {
    securityProfile: profile.autonomy === "supervised" ? "safe" : profile.autonomy === "autonomous" ? "autonomous" : "balanced",
    preferredProvider: profile.privacy === "local" ? "local" : profile.privacy === "hybrid" ? "local-or-cloud" : "cloud",
    routing: profile.modelStrategy,
    responseStyle: profile.explanation,
    teachingMode: profile.experience === "beginner",
    budgets: profile.budgets,
  }
}

export function adaptationPrompt(profile: UserAdaptationProfile): string {
  const detail = profile.explanation === "guided" ? "Explain decisions step by step and define unfamiliar terms." : profile.explanation === "detailed" ? "Give thorough technical explanations with tradeoffs." : "Keep explanations concise and action-oriented."
  const level = profile.experience === "beginner" ? "The user is learning; avoid unexplained jargon and teach while working." : profile.experience === "advanced" ? "The user is advanced; prioritize precision, control, and implementation detail." : "Assume normal programming familiarity."
  const privacy = profile.privacy === "local" ? "Prefer local tools and local models; do not send project content to external services unless the user explicitly approves." : profile.privacy === "hybrid" ? "Prefer local processing when practical and clearly identify external network use." : "Cloud providers are acceptable while still protecting secrets."
  const budgets = [profile.budgets.sessionUsd !== null ? `session USD ${profile.budgets.sessionUsd}` : "", profile.budgets.dailyUsd !== null ? `daily USD ${profile.budgets.dailyUsd}` : ""].filter(Boolean).join(", ")
  return ["## Spectra user adaptation", level, detail, privacy, `Preferred model strategy: ${profile.modelStrategy}.`, budgets ? `User budget preference: ${budgets}. Avoid unnecessary model calls.` : ""].filter(Boolean).join("\n")
}
