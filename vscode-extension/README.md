# Spectra for VS Code

Brings the [Spectra](../README.md) spec-driven AI coding agent into VS Code —
chat, Full-Stack autopilot, MCP, skills, model routing, and the rest — embedded
in an editor panel.

## How it works

The extension launches `spectra serve` in your workspace folder and embeds the
existing Spectra web UI in a webview panel. The agent runs against the same
engine as the CLI, operating on the open project.

## Setup

```bash
cd vscode-extension
npm install
npm run compile
```

Then press **F5** in VS Code to launch an Extension Development Host, or package
it with `npx vsce package`.

You need Spectra installed and on your `PATH` (or set `spectra.command` to
`node /absolute/path/to/dist/cli.js`).

## Commands

- **Spectra: Open Panel** — open the agent panel (auto-starts the server).
- **Spectra: Start Server** / **Spectra: Stop Server** — manage the backend.

## Settings

| Setting | Default | Description |
|---|---|---|
| `spectra.command` | `spectra` | Command used to launch Spectra. |
| `spectra.port` | `4096` | Port the server listens on. |
| `spectra.autoStart` | `true` | Start the server when opening the panel. |
