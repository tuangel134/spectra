import type { PermissionMap, SecurityProfile, SpectraConfig } from "../config/types.js"

export interface SecurityProfileDefinition {
  id: SecurityProfile
  name: string
  description: string
  autoApprove: boolean
  permission: PermissionMap
  autorun?: {
    parallel?: boolean
    maxParallel?: number
  }
}

export const SECURITY_PROFILES: Record<SecurityProfile, SecurityProfileDefinition> = {
  legacy: {
    id: "legacy",
    name: "Legacy",
    description: "Preserves the historical Spectra behavior without changing existing permissions.",
    autoApprove: true,
    permission: {},
  },
  safe: {
    id: "safe",
    name: "Safe",
    description: "Read freely, but ask before edits, commands, network activity, delegation, or unknown tools.",
    autoApprove: false,
    permission: {
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      todowrite: "allow",
      question: "allow",
      skill: "allow",
      lsp: "allow",
      spec: "allow",
      edit: "ask",
      bash: "ask",
      webfetch: "ask",
      websearch: "ask",
      task: "ask",
      "*": "ask",
    },
    autorun: { parallel: false, maxParallel: 1 },
  },
  balanced: {
    id: "balanced",
    name: "Balanced",
    description: "Allow normal workspace edits while supervising shell commands, delegation, and unknown tools.",
    autoApprove: false,
    permission: {
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      todowrite: "allow",
      question: "allow",
      skill: "allow",
      lsp: "allow",
      spec: "allow",
      edit: "allow",
      webfetch: "allow",
      websearch: "allow",
      bash: "ask",
      task: "ask",
      "*": "ask",
    },
    autorun: { parallel: true, maxParallel: 4 },
  },
  autonomous: {
    id: "autonomous",
    name: "Autonomous",
    description: "Let Spectra work independently inside a trusted workspace while retaining hard safety gates.",
    autoApprove: true,
    permission: {
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      todowrite: "allow",
      question: "allow",
      skill: "allow",
      lsp: "allow",
      spec: "allow",
      edit: "allow",
      webfetch: "allow",
      websearch: "allow",
      bash: "allow",
      task: "allow",
      "*": "ask",
    },
    autorun: { parallel: true, maxParallel: 8 },
  },
  unrestricted: {
    id: "unrestricted",
    name: "Unrestricted",
    description: "Maximum freedom. Intended only for expert users inside disposable or sandboxed environments.",
    autoApprove: true,
    permission: {
      "*": "allow",
    },
    autorun: { parallel: true, maxParallel: 12 },
  },
}

export function isSecurityProfile(value: unknown): value is SecurityProfile {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SECURITY_PROFILES, value)
}

export function listSecurityProfiles(): SecurityProfileDefinition[] {
  return Object.values(SECURITY_PROFILES)
}

/**
 * Apply a profile to the in-memory runtime configuration.
 *
 * The legacy profile deliberately does nothing so existing CLI users retain
 * their historical behavior until they explicitly choose a modern profile.
 */
export function applySecurityProfile(config: SpectraConfig, profile: SecurityProfile): void {
  config.security = { ...config.security, profile }
  if (profile === "legacy") return

  const preset = SECURITY_PROFILES[profile]
  // Mutate the existing objects instead of replacing them. AgentLoop and the
  // autorun manager retain references to these objects, so in-place updates
  // make a profile switch effective immediately without dropping the session.
  for (const key of Object.keys(config.permission)) delete config.permission[key]
  Object.assign(config.permission, structuredClone(preset.permission))
  config.autoApprove = preset.autoApprove
  if (preset.autorun) Object.assign(config.autorun, preset.autorun)
}
