/**
 * Native, lightweight desktop launcher.
 *
 * Spectra Desktop is NOT a heavyweight Electron bundle. It is the real engine
 * (started in-process) rendered in a native OS window. The launcher picks the
 * lightest available shell, in order:
 *
 *   1. A compiled Tauri binary (true native app, ~a few MB, system WebView).
 *   2. A Chromium-family browser in "app mode" (`--app=`), which gives a
 *      chromeless, app-like window using a browser the user already has —
 *      zero extra weight, no Chromium bundled.
 *   3. The default browser via `xdg-open`/`open`, keeping the server alive.
 *
 * This keeps the desktop experience native and tiny, while the CLI/TUI remains
 * the ultra-light, command-driven surface.
 */

import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, renameSync } from "node:fs"
import { createServer as netCreateServer } from "node:net"
import { tmpdir, platform, arch } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import type { Runtime } from "../runtime.js"
import { createServer } from "../server/index.js"
import { color, BRAND, logger } from "../util/logger.js"

const RELEASE_BASE = "https://github.com/tuangel134/spectra/releases/latest/download"

/** The release asset name for this OS/arch, or null if we don't ship one. */
function nativeAssetName(): string | null {
  const p = platform()
  const a = arch()
  if (p === "linux" && a === "x64") return "spectra-desktop-linux-x86_64"
  if (p === "darwin" && a === "arm64") return "spectra-desktop-macos-arm64"
  if (p === "win32" && a === "x64") return "spectra-desktop-windows-x86_64.exe"
  return null
}

/**
 * Download the prebuilt native desktop binary from the GitHub Release for this
 * OS/arch, cache it under desktop-native/target/release, and return its path.
 * Best-effort: returns null (→ browser fallback) if unavailable.
 */
async function downloadNativeBinary(here: string, report: (s: string) => void): Promise<string | null> {
  const asset = nativeAssetName()
  if (!asset) return null
  const root = join(here, "..", "..")
  const exe = platform() === "win32" ? "spectra-desktop.exe" : "spectra-desktop"
  const destDir = join(root, "desktop-native", "target", "release")
  const dest = join(destDir, exe)
  try {
    report(`${BRAND} ${color.gray(`downloading native desktop (${asset})…`)}\n`)
    const res = await fetch(`${RELEASE_BASE}/${asset}`, { redirect: "follow" })
    if (!res.ok) return null
    // Only accept from the pinned GitHub release host (redirects land on a CDN,
    // but the final URL must still be GitHub's release infrastructure).
    if (!/^https:\/\/[^/]*(github\.com|githubusercontent\.com|github-releases[^/]*)\//.test(res.url)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 4096) return null // too small to be a real binary
    // Reject HTML/text error pages that slipped through with a 200.
    const head = buf.subarray(0, 64).toString("latin1").trimStart().toLowerCase()
    if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("{")) return null
    mkdirSync(destDir, { recursive: true })
    // Write to a temp file then atomically rename, so an interrupted download
    // can never leave a partial binary that a later run would execute.
    const tmp = join(destDir, `.${exe}.download-${process.pid}`)
    writeFileSync(tmp, buf)
    if (platform() !== "win32") chmodSync(tmp, 0o755)
    renameSync(tmp, dest)
    return dest
  } catch {
    return null // offline or blocked → fall back to a browser window
  }
}

/** Resolve the path of an executable on PATH, or null if absent. */
function which(bin: string): string | null {
  const cmd = platform() === "win32" ? "where" : "which"
  const r = spawnSync(cmd, [bin], { encoding: "utf8" })
  if (r.status !== 0) return null
  const line = (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean)[0]
  return line || null
}

/** Is a TCP port free to bind on localhost? */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = netCreateServer()
    srv.once("error", () => resolve(false))
    srv.once("listening", () => srv.close(() => resolve(true)))
    srv.listen(port, "127.0.0.1")
  })
}

/** Find the first free port at or after `preferred`. */
async function findFreePort(preferred: number): Promise<number> {
  for (let p = preferred; p < preferred + 50; p++) {
    if (await probePort(p)) return p
  }
  return preferred
}

/** Locate a compiled native desktop binary (wry/tao) if it was built. */
function findNativeBinary(here: string): string | null {
  const root = join(here, "..", "..")
  const exe = platform() === "win32" ? "spectra-desktop.exe" : "spectra-desktop"
  const candidates = [
    join(root, "desktop-native", "target", "release", exe),
    join(root, "desktop-native", "target", "debug", exe),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

/** Find a Chromium-family browser that supports `--app=` windows. */
function findChromiumBrowser(): string | null {
  if (platform() === "win32") {
    // Chrome/Edge on Windows live under Program Files / LocalAppData, not PATH.
    const bases = [
      process.env["PROGRAMFILES"],
      process.env["PROGRAMFILES(X86)"],
      process.env["LOCALAPPDATA"],
    ].filter((b): b is string => Boolean(b))
    const rel = [
      ["Google", "Chrome", "Application", "chrome.exe"],
      ["Microsoft", "Edge", "Application", "msedge.exe"],
      ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
      ["Chromium", "Application", "chrome.exe"],
    ]
    for (const base of bases) {
      for (const parts of rel) {
        const p = join(base, ...parts)
        if (existsSync(p)) return p
      }
    }
    // Last resort: maybe one is on PATH.
    for (const n of ["chrome", "msedge", "brave", "chromium"]) {
      const p = which(n)
      if (p) return p
    }
    return null
  }

  const names =
    platform() === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "brave", "brave-browser", "microsoft-edge", "vivaldi-stable"]
  for (const n of names) {
    if (n.startsWith("/")) {
      if (existsSync(n)) return n
    } else {
      const p = which(n)
      if (p) return p
    }
  }
  return null
}

/** Open the user's default browser at `url` (non-app fallback). */
function openDefaultBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open"
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url]
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref()
  } catch {
    /* ignore */
  }
}

/**
 * Start the engine and open it in the lightest native window available.
 * Resolves when the desktop window closes (app-mode/Tauri) or on Ctrl-C
 * (default-browser fallback).
 */
export async function launchDesktop(rt: Runtime, projectRoot: string): Promise<void> {
  const host = "127.0.0.1"
  const preferred = rt.config.config.server?.port ?? 4123
  const port = await findFreePort(preferred)
  const server = createServer(rt, { port, hostname: host, cors: [`http://${host}:${port}`] })
  await server.listen()
  const url = `http://${host}:${port}/desktop`

  let closed = false
  const shutdown = async (): Promise<void> => {
    if (closed) return
    closed = true
    try {
      await server.close()
    } catch {
      /* ignore */
    }
  }
  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0))
  })

  // 1. Native binary (wry/tao) — use a built one, or download the prebuilt
  //    release binary for this OS/arch on first run.
  const here = dirname(fileURLToPath(import.meta.url))
  const native = findNativeBinary(here) ?? (await downloadNativeBinary(here, stdoutWrite))
  if (native) {
    stdoutWrite(`${BRAND} ${color.gray("launching native desktop…")}\n`)
    await runWindow(native, [], { SPECTRA_URL: url, SPECTRA_CWD: projectRoot, SPECTRA_TITLE: `Spectra — ${projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? "Workspace"}` })
    await shutdown()
    return
  }

  // 2. Chromium-family browser in app mode (chromeless, app-like window).
  const chrome = findChromiumBrowser()
  if (chrome) {
    stdoutWrite(`${BRAND} ${color.gray("launching desktop window…")}\n`)
    const profileDir = mkdtempSync(join(tmpdir(), "spectra-desktop-"))
    const args = [
      `--app=${url}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--class=Spectra",
      "--window-size=1180,760",
    ]
    await runWindow(chrome, args, {})
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    await shutdown()
    return
  }

  // 3. Fallback: default browser; keep the server running until Ctrl-C.
  stdoutWrite(`${BRAND} web UI at ${color.cyan(url)}\n`)
  stdoutWrite(color.gray("Opening your browser. Press Ctrl-C to stop the desktop engine.\n"))
  openDefaultBrowser(url)
  await new Promise<void>(() => {
    /* run until SIGINT */
  })
}

/** Spawn a window process and resolve when it exits. */
function runWindow(bin: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: "ignore",
      env: { ...process.env, ...env },
    })
    child.on("close", () => resolve())
    child.on("error", (err) => {
      logger.error(`Failed to launch desktop window: ${err.message}`)
      resolve()
    })
  })
}

function stdoutWrite(s: string): void {
  process.stdout.write(s)
}
