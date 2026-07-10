# Adaptive Spectra Desktop

Spectra Desktop stores non-secret user preferences in a versioned, exportable profile. The profile controls experience level, autonomy, response detail, privacy preference, model routing strategy, accessibility, language, and optional spending limits.

## Privacy

API keys entered in Model Lab are used only for that probe request and are never written to the adaptation profile. Exported profiles contain no provider credentials.

## Local model detection

Desktop probes loopback-only endpoints for Ollama, LM Studio, llama.cpp, and vLLM. Detection is bounded by short timeouts and does not scan the network.

## Ecosystem Center

The inventory combines Spectra and Claude-compatible skills, commands, agents, plugins, and MCP configuration so users can see what the current project can load.
