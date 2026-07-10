/**
 * Provider registry.
 *
 * Resolves "provider/model-id" strings into concrete provider clients with
 * the correct base URL, API key, and SDK family. Handles OpenCode Zen routing
 * and custom base-URL providers.
 */

import type { ProviderConfig, SpectraConfig } from "../config/types.js"
import type { Provider, ResolvedModel, ModelInfo, SdkFamily } from "./types.js"
import { ProviderError } from "./types.js"
import { AnthropicProvider } from "./anthropic.js"
import { OpenAIProvider } from "./openai.js"
import { zenSdkFamily, zenBaseURL, goSdkFamily, goBaseURL, ZEN_MODELS, GO_MODELS } from "./zen.js"
import { getFreeModels } from "./free-models.js"
import { detectFreebuffToken, hasFreebuffToken, FREEBUFF_MODELS, FREEBUFF_DEFAULT_BASE } from "./freebuff.js"

/** Look up a known context window (tokens) for a provider/model pair. */
function knownContextWindow(providerId: string, modelId: string): number | undefined {
  const tables: Record<string, { id: string; context: number }[]> = {
    opencode: ZEN_MODELS,
    "opencode-go": GO_MODELS,
    free: getFreeModels(),
    freebuff: FREEBUFF_MODELS,
  }
  const table = tables[providerId]
  const found = table?.find((m) => m.id === modelId)
  return found?.context
}

/** Built-in defaults for well-known providers. */
interface ProviderDefaults {
  name: string
  baseURL: string
  sdk: SdkFamily
  envKey: string
}

const KNOWN: Record<string, ProviderDefaults> = {
  opencode: {
    name: "OpenCode Zen",
    baseURL: "https://opencode.ai/zen/v1",
    sdk: "anthropic", // overridden per-model by zen routing
    envKey: "OPENCODE_API_KEY",
  },
  "opencode-go": {
    name: "OpenCode Go",
    baseURL: "https://opencode.ai/zen/go/v1",
    sdk: "openai-compatible", // overridden per-model by go routing
    envKey: "OPENCODE_GO_API_KEY",
  },
  free: {
    name: "OpenCode Free",
    baseURL: "https://opencode.ai/zen/v1",
    sdk: "openai-compatible", // free models are served via /chat/completions
    envKey: "OPENCODE_FREE_API_KEY",
  },
  openrouter: {
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    sdk: "openai-compatible", // unified OpenAI-compatible gateway (incl. :free models)
    envKey: "OPENROUTER_API_KEY",
  },
  groq: {
    name: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    sdk: "openai-compatible",
    envKey: "GROQ_API_KEY",
  },
  cerebras: {
    name: "Cerebras",
    baseURL: "https://api.cerebras.ai/v1",
    sdk: "openai-compatible",
    envKey: "CEREBRAS_API_KEY",
  },
  mistral: {
    name: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    sdk: "openai-compatible",
    envKey: "MISTRAL_API_KEY",
  },
  deepseek: {
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    sdk: "openai-compatible",
    envKey: "DEEPSEEK_API_KEY",
  },
  xai: {
    name: "xAI (Grok)",
    baseURL: "https://api.x.ai/v1",
    sdk: "openai-compatible",
    envKey: "XAI_API_KEY",
  },
  freebuff: {
    name: "Freebuff (Codebuff free)",
    baseURL: FREEBUFF_DEFAULT_BASE, // OpenAI-compatible via the freebuff2api proxy
    sdk: "openai-compatible",
    envKey: "FREEBUFF_AUTH_TOKEN",
  },
  anthropic: {
    name: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    sdk: "anthropic",
    envKey: "ANTHROPIC_API_KEY",
  },
  openai: {
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    sdk: "openai",
    envKey: "OPENAI_API_KEY",
  },
  google: {
    name: "Google",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    sdk: "openai-compatible",
    envKey: "GOOGLE_API_KEY",
  },
  ollama: {
    name: "Ollama (local)",
    baseURL: "http://localhost:11434/v1",
    sdk: "openai-compatible",
    envKey: "OLLAMA_API_KEY",
  },
}

export class ProviderRegistry {
  private readonly providers: Record<string, ProviderConfig>
  private readonly anthropicClient = new AnthropicProvider()
  private readonly openaiClient = new OpenAIProvider("openai")
  private readonly compatibleClient = new OpenAIProvider("openai-compatible")

  constructor(config: SpectraConfig) {
    this.providers = config.provider ?? {}
  }

  /** Add or replace a provider configuration at runtime. */
  upsertProvider(id: string, config: ProviderConfig): void {
    const existing = this.providers[id] ?? {}
    this.providers[id] = {
      ...existing,
      ...config,
      options: { ...existing.options, ...config.options },
    }
  }

  /** Remove a provider from the active runtime registry. */
  deleteProvider(id: string): void {
    delete this.providers[id]
  }

  /** The base URL for a provider (user override or known default), or null. */
  baseUrlFor(id: string): string | null {
    const u = this.providers[id]
    if (u?.baseURL) return u.baseURL
    if (u?.options?.baseURL) return u.options.baseURL
    return KNOWN[id]?.baseURL ?? null
  }

  /**
   * Fetch the provider's LIVE `/models` list and replace its stored models, so
   * pickers always show current models instead of a stale hardcoded set.
   * Best-effort: returns the fetched ids, or [] if unavailable.
   */
  async refreshModels(id: string): Promise<string[]> {
    const baseURL = this.baseUrlFor(id)
    if (!baseURL) return []
    const apiKey = this.resolveApiKey(id, KNOWN[id], this.providers[id])
    const { fetchLiveModels } = await import("./model-catalog.js")
    const ids = await fetchLiveModels(baseURL, apiKey)
    if (ids.length === 0) return []
    const models: Record<string, { name: string }> = {}
    for (const mid of ids) models[mid] = { name: mid }
    this.upsertProvider(id, { models })
    return ids
  }

  /** Whether a provider has a usable API key (inline or via env). */
  hasCredentials(providerId: string): boolean {
    // The free provider needs no key — it works out of the box.
    if (providerId === "free") return true
    // Freebuff: token auto-detected from the freebuff CLI credentials file.
    if (providerId === "freebuff") {
      return Boolean(this.providers["freebuff"]?.options?.apiKey) || hasFreebuffToken()
    }
    const known = KNOWN[providerId]
    const userConfig = this.providers[providerId]
    if (userConfig?.options?.apiKey) return true
    // Local/custom OpenAI-compatible APIs often intentionally have no key.
    if (!known && userConfig?.baseURL && userConfig.sdk === "openai-compatible") return true
    const envKey = known?.envKey ?? `${providerId.toUpperCase()}_API_KEY`
    return Boolean(process.env[envKey])
  }

  /** Resolve a "provider/model" string into a ResolvedModel. */
  resolve(modelString: string): ResolvedModel {
    const slashIndex = modelString.indexOf("/")
    if (slashIndex === -1) {
      throw new ProviderError(
        `Invalid model "${modelString}". Expected format "provider/model-id".`,
      )
    }

    const providerId = modelString.slice(0, slashIndex)
    const modelId = modelString.slice(slashIndex + 1)

    const known = KNOWN[providerId]
    const userConfig = this.providers[providerId]

    if (!known && !userConfig) {
      throw new ProviderError(
        `Unknown provider "${providerId}". Configure it under "provider" in spectra.jsonc.`,
      )
    }

    const sdk = this.resolveSdk(providerId, modelId, known, userConfig)
    const baseURL = this.resolveBaseURL(providerId, modelId, known, userConfig)
    const apiKey = this.resolveApiKey(providerId, known, userConfig)
    const timeout = userConfig?.options?.timeout ?? 300_000
    const headers = userConfig?.options?.headers ?? {}

    const meta = userConfig?.models?.[modelId]
    const info: ModelInfo = {
      id: modelId,
      name: meta?.name ?? modelId,
      providerId,
      contextWindow: meta?.contextWindow ?? knownContextWindow(providerId, modelId) ?? 128_000,
      maxTokens: meta?.maxTokens,
      supportsTools: meta?.supportsTools ?? true,
      supportsImages: meta?.supportsImages ?? true,
    }

    return { providerId, modelId, baseURL, apiKey, sdk, headers, timeout, info }
  }

  private resolveSdk(
    providerId: string,
    modelId: string,
    known: ProviderDefaults | undefined,
    userConfig: ProviderConfig | undefined,
  ): SdkFamily {
    // Explicit user override.
    if (userConfig?.sdk && userConfig.sdk !== "zen") return userConfig.sdk
    // Zen and Go route by model id.
    if (providerId === "opencode" || userConfig?.sdk === "zen") {
      return zenSdkFamily(modelId)
    }
    if (providerId === "opencode-go") {
      return goSdkFamily(modelId)
    }
    return userConfig?.sdk === undefined
      ? (known?.sdk ?? "openai-compatible")
      : "openai-compatible"
  }

  private resolveBaseURL(
    providerId: string,
    modelId: string,
    known: ProviderDefaults | undefined,
    userConfig: ProviderConfig | undefined,
  ): string {
    if (userConfig?.baseURL) return userConfig.baseURL
    if (userConfig?.options?.baseURL) return userConfig.options.baseURL
    if (providerId === "opencode" || userConfig?.sdk === "zen") {
      return zenBaseURL(modelId)
    }
    if (providerId === "opencode-go") {
      return goBaseURL(modelId)
    }
    if (known) return known.baseURL
    throw new ProviderError(
      `Provider "${providerId}" has no baseURL configured.`,
    )
  }

  private resolveApiKey(
    providerId: string,
    known: ProviderDefaults | undefined,
    userConfig: ProviderConfig | undefined,
  ): string | undefined {
    if (userConfig?.options?.apiKey) return userConfig.options.apiKey
    // Freebuff: fall back to the token saved by the freebuff CLI.
    if (providerId === "freebuff") {
      return process.env["FREEBUFF_AUTH_TOKEN"] ?? detectFreebuffToken() ?? undefined
    }
    const envKey = known?.envKey ?? `${providerId.toUpperCase()}_API_KEY`
    return process.env[envKey]
  }

  /** Get the concrete provider client for a resolved model. */
  client(model: ResolvedModel): Provider {
    switch (model.sdk) {
      case "anthropic":
        return this.anthropicClient
      case "openai":
        return this.openaiClient
      case "openai-compatible":
        return this.compatibleClient
    }
  }

  /** List configured providers and their advertised models. */
  list(): { id: string; name: string; models: { id: string; name: string }[] }[] {
    const result: { id: string; name: string; models: { id: string; name: string }[] }[] = []

    const ids = new Set<string>([...Object.keys(KNOWN), ...Object.keys(this.providers)])

    for (const id of ids) {
      const known = KNOWN[id]
      const userConfig = this.providers[id]
      const name = known?.name ?? id

      let models: { id: string; name: string }[] = []
      if (userConfig?.models) {
        models = Object.entries(userConfig.models).map(([mid, m]) => ({
          id: mid,
          name: m.name ?? mid,
        }))
      }
      if (id === "opencode" && models.length === 0) {
        models = ZEN_MODELS.map((m) => ({ id: m.id, name: m.name }))
      }
      if (id === "opencode-go" && models.length === 0) {
        models = GO_MODELS.map((m) => ({ id: m.id, name: m.name }))
      }
      if (id === "free" && models.length === 0) {
        models = getFreeModels().map((m) => ({ id: m.id, name: m.name }))
      }
      if (id === "freebuff" && models.length === 0) {
        models = FREEBUFF_MODELS.map((m) => ({ id: m.id, name: m.name }))
      }

      result.push({ id, name, models })
    }

    return result
  }
}
