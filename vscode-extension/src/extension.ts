/**
 * Spectra VS Code extension.
 *
 * Brings the Spectra agent into VS Code: it launches `spectra serve` in the
 * workspace folder and embeds the existing web UI in a webview panel, so the
 * full experience (chat, autopilot, tabs, config) lives next to your editor.
 *
 * Build:  cd vscode-extension && npm install && npm run compile
 * Run:    press F5 in VS Code to launch an Extension Development Host.
 */

import * as vscode from "vscode"
import { spawn, type ChildProcess } from "node:child_process"
import * as http from "node:http"

let server: ChildProcess | undefined
let statusItem: vscode.StatusBarItem

function config() {
  const c = vscode.workspace.getConfiguration("spectra")
  return {
    command: c.get<string>("command", "spectra"),
    port: c.get<number>("port", 4096),
    autoStart: c.get<boolean>("autoStart", true),
  }
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

/** Resolve when the server answers /health, or reject after a timeout. */
function waitForServer(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 1000 }, (res) => {
        res.resume()
        if (res.statusCode === 200) resolve()
        else retry()
      })
      req.on("error", retry)
      req.on("timeout", () => { req.destroy(); retry() })
    }
    const retry = () => {
      if (Date.now() > deadline) reject(new Error("Spectra server did not start in time"))
      else setTimeout(tick, 500)
    }
    tick()
  })
}

async function startServer(): Promise<void> {
  if (server) return
  const { command, port } = config()
  const cwd = workspaceRoot()
  const [bin, ...baseArgs] = command.split(/\s+/)
  server = spawn(bin!, [...baseArgs, "serve"], {
    cwd,
    env: { ...process.env, SPECTRA_PORT: String(port) },
  })
  server.on("exit", () => { server = undefined; updateStatus() })
  updateStatus()
  await waitForServer(port)
}

function stopServer(): void {
  server?.kill()
  server = undefined
  updateStatus()
}

function updateStatus(): void {
  if (!statusItem) return
  statusItem.text = server ? "$(sparkle) Spectra ●" : "$(sparkle) Spectra"
  statusItem.tooltip = server ? "Spectra server running — click to open" : "Open Spectra"
  statusItem.show()
}

function panelHtml(port: number): string {
  const url = `http://127.0.0.1:${port}`
  // A webview that embeds the running Spectra UI. frame-src must allow localhost.
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://127.0.0.1:* http://localhost:*; style-src 'unsafe-inline';">
<style>html,body,iframe{margin:0;padding:0;height:100vh;width:100%;border:0;background:#0c0a14}</style>
</head><body><iframe src="${url}" allow="clipboard-read; clipboard-write"></iframe></body></html>`
}

async function openPanel(context: vscode.ExtensionContext): Promise<void> {
  const { port, autoStart } = config()
  if (autoStart && !server) {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Starting Spectra…" },
      () => startServer(),
    ).then(undefined, (err) => vscode.window.showErrorMessage(`Spectra: ${err.message}`))
  }
  const panel = vscode.window.createWebviewPanel("spectra", "Spectra", vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
  })
  panel.webview.html = panelHtml(port)
  context.subscriptions.push(panel)
}

export function activate(context: vscode.ExtensionContext): void {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusItem.command = "spectra.open"
  updateStatus()
  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand("spectra.open", () => openPanel(context)),
    vscode.commands.registerCommand("spectra.startServer", () =>
      startServer().then(
        () => vscode.window.showInformationMessage("Spectra server started."),
        (err) => vscode.window.showErrorMessage(`Spectra: ${err.message}`),
      ),
    ),
    vscode.commands.registerCommand("spectra.stopServer", () => {
      stopServer()
      vscode.window.showInformationMessage("Spectra server stopped.")
    }),
  )
}

export function deactivate(): void {
  stopServer()
}
