/**
 * OpenCode Zen and OpenCode Go compatibility.
 *
 * Both are OpenAI/Anthropic-compatible AI gateways. Model families are served
 * from different endpoint shapes, so we route by model id prefix.
 *
 * Zen (provider id "opencode"):
 *   claude, qwen  -> https://opencode.ai/zen/v1/messages          (anthropic)
 *   gpt           -> https://opencode.ai/zen/v1/responses         (openai)
 *   everything    -> https://opencode.ai/zen/v1/chat/completions  (compatible)
 *
 * Go (provider id "opencode-go"):  low-cost open-model subscription
 *   minimax, qwen -> https://opencode.ai/zen/go/v1/messages          (anthropic)
 *   everything    -> https://opencode.ai/zen/go/v1/chat/completions  (compatible)
 */

import type { SdkFamily } from "./types.js"

export const ZEN_BASE = "https://opencode.ai/zen/v1"
export const GO_BASE = "https://opencode.ai/zen/go/v1"

/** Determine which SDK family a Zen model id belongs to. */
export function zenSdkFamily(modelId: string): SdkFamily {
  if (modelId.startsWith("claude") || modelId.startsWith("qwen")) return "anthropic"
  if (modelId.startsWith("gpt")) return "openai"
  return "openai-compatible"
}

/** Determine which SDK family an OpenCode Go model id belongs to. */
export function goSdkFamily(modelId: string): SdkFamily {
  if (modelId.startsWith("minimax") || modelId.startsWith("qwen")) return "anthropic"
  return "openai-compatible"
}

/** Base URL for a Zen model (clients append /messages, /responses, etc.). */
export function zenBaseURL(_modelId: string): string {
  return ZEN_BASE
}

/** Base URL for an OpenCode Go model. */
export function goBaseURL(_modelId: string): string {
  return GO_BASE
}

/** Known Zen models with metadata, used for `spectra models` listing. */
export const ZEN_MODELS: { id: string; name: string; context: number }[] = [
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", context: 1_000_000 },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", context: 1_000_000 },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", context: 1_000_000 },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", context: 200_000 },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", context: 200_000 },
  { id: "gpt-5.5", name: "GPT 5.5", context: 272_000 },
  { id: "gpt-5.1-codex", name: "GPT 5.1 Codex", context: 272_000 },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", context: 1_000_000 },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", context: 128_000 },
  { id: "minimax-m2.5", name: "MiniMax M2.5", context: 200_000 },
  { id: "qwen3.7-max", name: "Qwen3.7 Max", context: 256_000 },
  { id: "glm-5.2", name: "GLM 5.2", context: 200_000 },
]

/**
 * OpenCode Free models — usable without any API key.
 *
 * BUNDLED FALLBACK only. The live list is fetched AND verified at runtime
 * (provider/free-models.ts probes each model with a keyless request), so this
 * list just needs to be a safe default. Only models confirmed to actually serve
 * for free (not just carrying the `-free` suffix) are listed here.
 */
export const FREE_MODELS: { id: string; name: string; context: number }[] = [
  { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash (free)", context: 128_000 },
  { id: "mimo-v2.5-free", name: "MiMo V2.5 (free)", context: 128_000 },
  { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra (free)", context: 128_000 },
  { id: "north-mini-code-free", name: "North Mini Code (free)", context: 128_000 },
]

/** Known OpenCode Go models. */
export const GO_MODELS: { id: string; name: string; context: number }[] = [
  { id: "glm-5.2", name: "GLM 5.2", context: 200_000 },
  { id: "glm-5.1", name: "GLM 5.1", context: 200_000 },
  { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", context: 256_000 },
  { id: "kimi-k2.6", name: "Kimi K2.6", context: 256_000 },
  { id: "mimo-v2.5", name: "MiMo-V2.5", context: 128_000 },
  { id: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro", context: 128_000 },
  { id: "minimax-m3", name: "MiniMax M3", context: 200_000 },
  { id: "minimax-m2.7", name: "MiniMax M2.7", context: 200_000 },
  { id: "qwen3.7-max", name: "Qwen3.7 Max", context: 256_000 },
  { id: "qwen3.7-plus", name: "Qwen3.7 Plus", context: 256_000 },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", context: 128_000 },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", context: 128_000 },
]
