# Changelog

## 0.1.0 — Initial Release

### Features
- **Spec-driven development** — requirements (EARS) → design → tasks → wave execution.
- **Full-Stack Autopilot** — long-running autonomous mode with phased plan, verification ×3, LSP diagnostics, skeleton gate, visual check (Playwright), anti-stall, watchdog, swarm parallel.
- **Model routing** — manual / semi-auto / auto + **Autochange** failover (up to 3 fallbacks) so long tasks never stop on token limits.
- **Headroom** — context compression (JSON table-ize, log dedup, reversible CCR). 60–99% token savings.
- **MCP client** — stdio + HTTP/SSE, auto-discovers tools from .spectra/mcp.json, .opencode/mcp.json, .cursor/mcp.json.
- **Skills** — SKILL.md (Claude Code / Kiro / OpenCode compatible directories).
- **Plugins** — `.spectra/plugins/*.js` that register custom tools.
- **LSP** — real-time diagnostics (TypeScript, Python, Go, Rust language servers).
- **Subagents** — `task` tool delegates to isolated subagents (explore/review/…).
- **Git tools** — git_status, git_diff, git_commit, git_branch with branch protection.
- **Browser** — headless Playwright for screenshot + vision verification.
- **Stealth fetch** — Scrapling for Cloudflare/CAPTCHA bypass (auto-fallback from webfetch).
- **Multimodal** — image paste/drop in chat, sent to vision-capable models.
- **OAuth login** — device flow (`spectra auth login copilot`).
- **Project memory** — persistent cross-session fact store (memory tool).
- **Timeline** — snapshot restore points with rewind.
- **Evals** — capability scorecard + auto-growing regression cases.
- **ACP server** — `spectra acp` for editor integration (Zed, etc.).
- **VS Code extension** — embeds Spectra in an editor panel.
- **Desktop app** — native, lightweight window (system WebView, ~644 KB binary; no Electron).
- **TUI** — full-screen terminal interface with themes, slash commands, flows.
- **Hooks + Steering** — event automations + persistent project rules.
- **Compaction** — intelligent conversation summarization near context limit.
- **Cost estimation** — live $ estimate per session.
- **Message queue** — send while busy; messages queue and execute in order.
- **Interrupt** — stop button cancels the active request immediately.
- **Auth + CORS** — per-launch token protects the HTTP server.
- **Retries with backoff** — 5xx errors retried automatically.
- **Session persistence** — chat history survives restarts.
- **CI** — GitHub Actions (build + test + eval, Node 20/22).

### Providers
- OpenCode Zen + Go (subscription routing), free models (no login).
- Anthropic, OpenAI, Google, Ollama, any OpenAI-compatible endpoint.

### UI
- Markdown rendering with syntax-highlighted code blocks (marked + highlight.js).
- Live "Working…" card with spinner showing each tool step.
- Fade-in animations, glassmorphism, hover glows, pulse effects.
- Desktop notifications on task completion.
- Chat search (Ctrl+F).
- Connection-lost banner with auto-recovery.
