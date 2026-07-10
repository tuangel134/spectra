export type ExperienceLevel = "beginner" | "intermediate" | "advanced"
export type AutonomyLevel = "supervised" | "balanced" | "autonomous"
export type InterfaceLanguage = "es" | "en"
export type ExplanationLevel = "guided" | "concise" | "detailed"
export type PrivacyMode = "cloud" | "hybrid" | "local"
export type ModelStrategy = "quality" | "balanced" | "economy" | "local-first"
export type Density = "comfortable" | "compact"

export interface AccessibilityPreferences {
  fontScale: number
  density: Density
  highContrast: boolean
  reducedMotion: boolean
  colorVision: "default" | "deuteranopia" | "protanopia" | "tritanopia"
}

export interface BudgetPreferences {
  sessionUsd: number | null
  dailyUsd: number | null
}

export interface UserAdaptationProfile {
  schemaVersion: 1
  onboardingCompleted: boolean
  experience: ExperienceLevel
  autonomy: AutonomyLevel
  language: InterfaceLanguage
  explanation: ExplanationLevel
  privacy: PrivacyMode
  modelStrategy: ModelStrategy
  accessibility: AccessibilityPreferences
  budgets: BudgetPreferences
  updatedAt: number
}

export interface LocalRuntimeCandidate {
  id: "ollama" | "lm-studio" | "llama-cpp" | "vllm"
  name: string
  baseURL: string
  modelsURL: string
}

export interface LocalRuntimeResult extends LocalRuntimeCandidate {
  online: boolean
  latencyMs?: number
  models: string[]
  error?: string
}

export interface ModelProbeInput {
  baseURL: string
  apiKey?: string
  model?: string
  deep?: boolean
}

export interface ModelProbeResult {
  ok: boolean
  normalizedBaseURL: string
  latencyMs: number
  models: string[]
  selectedModel?: string
  capabilities: {
    discovery: boolean
    streaming: boolean | null
    toolCalling: boolean | null
    structuredOutput: boolean | null
  }
  compatibilityScore: number
  diagnostics: string[]
}

export interface EcosystemItem {
  kind: "skill" | "agent" | "plugin" | "mcp" | "command"
  name: string
  source: "spectra" | "claude" | "project" | "user"
  path: string
  enabled: boolean
}

export interface EcosystemInventory {
  items: EcosystemItem[]
  counts: Record<EcosystemItem["kind"], number>
}
