/**
 * Concrete TUI flows: connecting providers and switching models.
 */

import type { Runtime } from "../runtime.js"
import type { Flow, FlowStep, FlowOption } from "./flow.js"
import { saveProviderKey, saveModel } from "../config/writer.js"
import { staticCatalog } from "../provider/catalog.js"

interface ConnectableProvider {
  id: string
  name: string
  hint: string
  needsKey: boolean
  custom?: boolean
  baseURL?: string
  suggestedModel?: string
}

export const CONNECTABLE: ConnectableProvider[] = [
  {
    id: "opencode",
    name: "OpenCode Zen",
    hint: "key from opencode.ai/auth",
    needsKey: true,
    suggestedModel: "opencode/claude-sonnet-4-6",
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    hint: "low-cost open-model subscription",
    needsKey: true,
    suggestedModel: "opencode-go/kimi-k2.7-code",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    hint: "console.anthropic.com",
    needsKey: true,
    suggestedModel: "anthropic/claude-sonnet-4-5",
  },
  {
    id: "openai",
    name: "OpenAI",
    hint: "platform.openai.com",
    needsKey: true,
    suggestedModel: "openai/gpt-5.1",
  },
  {
    id: "google",
    name: "Google Gemini",
    hint: "aistudio.google.com",
    needsKey: true,
    suggestedModel: "google/gemini-3.1-pro",
  },
  {
    id: "groq",
    name: "Groq",
    hint: "console.groq.com — very fast",
    needsKey: true,
    suggestedModel: "groq/llama-3.3-70b-versatile",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    hint: "openrouter.ai — 100s of models, incl. :free",
    needsKey: true,
    suggestedModel: "openrouter/", // pick from the live list after connecting
  },
  {
    id: "cerebras",
    name: "Cerebras",
    hint: "cloud.cerebras.ai — fastest inference",
    needsKey: true,
    suggestedModel: "cerebras/llama-3.3-70b",
  },
  {
    id: "mistral",
    name: "Mistral",
    hint: "console.mistral.ai",
    needsKey: true,
    suggestedModel: "mistral/mistral-large-latest",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    hint: "platform.deepseek.com",
    needsKey: true,
    suggestedModel: "deepseek/deepseek-chat",
  },
  {
    id: "ollama",
    name: "Ollama (local, no key)",
    hint: "runs on your machine",
    needsKey: false,
    baseURL: "http://localhost:11434/v1",
    suggestedModel: "ollama/llama3.2",
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    hint: "your own base URL",
    needsKey: true,
    custom: true,
  },
]

export interface FlowResult {
  message: string
  modelToSet?: string
  connectedProvider?: string
}

/**
 * Build the interactive /connect flow. The optional onResult callback receives
 * a summary so the app can update its state and show a confirmation.
 */
export function connectFlow(rt: Runtime, onResult: (r: FlowResult) => void): Flow {
  const providerOptions: FlowOption[] = CONNECTABLE.map((p) => ({
    label: `${p.name} — ${p.hint}`,
    value: p.id,
  }))

  return {
    title: "Connect a provider",

    next(answers: string[]): FlowStep | null {
      // Step 0: choose provider.
      if (answers.length === 0) {
        return { question: "Select a provider to connect:", options: providerOptions }
      }

      const provider = CONNECTABLE.find((p) => p.id === answers[0])
      if (!provider) return null

      if (provider.custom) {
        // answers: [custom, providerId, baseURL, apiKey]
        if (answers.length === 1) {
          return {
            question: "Provider id (e.g. my-api):",
            validate: (v) => (v ? null : "A provider id is required."),
          }
        }
        if (answers.length === 2) {
          return {
            question: "Base URL (e.g. https://host/v1):",
            validate: (v) => (/^https?:\/\//.test(v) ? null : "Must start with http(s)://"),
          }
        }
        if (answers.length === 3) {
          return { question: "API key:", mask: true }
        }
        return null
      }

      if (!provider.needsKey) {
        return null // Ollama: nothing else to ask.
      }

      // Known provider needing a key.
      if (answers.length === 1) {
        return {
          question: `Paste your ${provider.name} API key:`,
          mask: true,
          validate: (v) => (v ? null : "An API key is required."),
        }
      }
      return null
    },

    async complete(answers: string[]): Promise<void> {
      const providerId0 = answers[0]!
      const provider = CONNECTABLE.find((p) => p.id === providerId0)!

      let savedProvider = providerId0
      let suggested = provider.suggestedModel

      if (provider.custom) {
        const [, customId, baseURL, apiKey] = answers
        saveProviderKey(customId!, apiKey ?? "", baseURL)
        rt.providers.upsertProvider(customId!, {
          baseURL,
          sdk: "openai-compatible",
          options: { apiKey: apiKey ?? "" },
        })
        savedProvider = customId!
        suggested = `${customId}/`
      } else if (!provider.needsKey) {
        // Ollama
        saveProviderKey("ollama", "ollama", provider.baseURL)
        rt.providers.upsertProvider("ollama", {
          baseURL: provider.baseURL,
          sdk: "openai-compatible",
          options: { apiKey: "ollama" },
        })
      } else {
        const apiKey = answers[1]!
        saveProviderKey(providerId0, apiKey)
        rt.providers.upsertProvider(providerId0, { options: { apiKey } })
      }

      // Auto-select a sensible model for the newly connected provider.
      let modelToSet: string | undefined
      if (suggested && suggested.includes("/") && !suggested.endsWith("/")) {
        rt.config.config.model = suggested
        saveModel(suggested)
        modelToSet = suggested
      }

      // Pull the provider's LIVE model list so the picker shows current models
      // (not a stale hardcoded set). Best-effort — never blocks connecting.
      let liveModels: string[] = []
      try {
        liveModels = await rt.providers.refreshModels(savedProvider)
      } catch {
        /* offline / non-OpenAI shape — ignore */
      }
      // If we didn't set a concrete model but the provider advertises models,
      // adopt the first one so the user has a working default immediately.
      if (!modelToSet && liveModels.length > 0) {
        const picked = `${savedProvider}/${liveModels[0]}`
        rt.config.config.model = picked
        saveModel(picked)
        modelToSet = picked
      }

      onResult({
        message: `✓ Connected ${savedProvider}.${
          liveModels.length ? ` ${liveModels.length} models available.` : ""
        } Saved to your global config.${modelToSet ? ` Model set to ${modelToSet}.` : ""}`,
        modelToSet,
        connectedProvider: savedProvider,
      })
    },
  }
}

/** Build the interactive /model picker flow over the full catalog. */
export function modelFlow(rt: Runtime, onResult: (r: FlowResult) => void): Flow {
  // Full catalog: free + Zen + Go + direct providers + configured custom models.
  const entries = staticCatalog()

  // Add models from any user-configured custom providers.
  for (const p of rt.providers.list()) {
    if (["free", "opencode", "opencode-go", "anthropic", "openai", "google"].includes(p.id)) continue
    for (const m of p.models) {
      entries.push({ id: `${p.id}/${m.id}`, providerId: p.id, label: `${m.id} (${p.id})`, free: false })
    }
  }

  const options: FlowOption[] = entries.map((e) => ({
    label: `${e.id}${e.free ? "  ·free" : rt.providers.hasCredentials(e.providerId) ? "  ·ready" : ""}`,
    value: e.id,
  }))

  const providerOf = (modelId: string): string => modelId.split("/")[0] ?? ""

  return {
    title: "Switch model",
    next(answers: string[]): FlowStep | null {
      if (answers.length === 0) {
        return {
          question: "Select a model (number, or type provider/model-id):",
          options,
          allowFreeText: true,
        }
      }
      // Step 1: if the chosen model's provider has no key, ask for it inline.
      const providerId = providerOf(answers[0]!)
      if (answers.length === 1 && providerId !== "free" && !rt.providers.hasCredentials(providerId)) {
        return {
          question: `${providerId} needs an API key. Paste it (or leave empty to skip):`,
          mask: true,
        }
      }
      return null
    },
    async complete(answers: string[]): Promise<void> {
      const model = answers[0]!
      const providerId = providerOf(model)
      const apiKey = answers[1]

      // Save an inline key if one was provided during the flow.
      if (apiKey) {
        saveProviderKey(providerId, apiKey)
        rt.providers.upsertProvider(providerId, { options: { apiKey } })
      }

      rt.config.config.model = model
      // The per-session model is applied by the caller (onResult) against its
      // OWN stable chat session — not rt.sessions.current(), which can point at
      // a transient spec/subagent session and would set the model on the wrong
      // conversation.
      saveModel(model)

      const note =
        providerId !== "free" && !rt.providers.hasCredentials(providerId)
          ? " (no key set — run /connect to add one before using it)"
          : ""
      onResult({ message: `✓ Model set to ${model}.${note}`, modelToSet: model })
    },
  }
}
