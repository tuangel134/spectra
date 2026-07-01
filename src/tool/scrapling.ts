/**
 * Scrapling integration — stealth web fetching that survives anti-bot walls.
 *
 * Scrapling (https://github.com/D4Vinci/Scrapling, BSD-3) ships a StealthyFetcher
 * that bypasses Cloudflare Turnstile/Interstitial and similar CAPTCHA gates. We
 * shell out to its CLI:
 *
 *   scrapling extract stealthy-fetch <url> <out.md> --solve-cloudflare
 *
 * It is an optional, locally-installed dependency. When it is not present we
 * return clear install guidance instead of failing opaquely.
 */

import { spawn } from "node:child_process"
import { readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface StealthResult {
  ok: boolean
  output: string
  /** True when Scrapling itself is not installed. */
  missing?: boolean
}

export const SCRAPLING_INSTALL_HINT =
  'Scrapling is not installed. Install it with:\n' +
  '  pip install "scrapling[fetchers]" && scrapling install\n' +
  "It enables stealth fetching that bypasses Cloudflare/CAPTCHA walls."

let cachedAvailable: boolean | null = null

/** Detect whether the `scrapling` CLI is on PATH (cached). */
export function scraplingAvailable(): Promise<boolean> {
  if (cachedAvailable !== null) return Promise.resolve(cachedAvailable)
  return new Promise<boolean>((resolve) => {
    const child = spawn("scrapling", ["--version"], { stdio: "ignore" })
    child.on("error", () => {
      cachedAvailable = false
      resolve(false)
    })
    child.on("close", (code) => {
      cachedAvailable = code === 0
      resolve(cachedAvailable)
    })
  })
}

/** Heuristic: does this response look like an anti-bot / CAPTCHA wall? */
export function looksBlocked(status: number, body: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true
  const b = body.toLowerCase()
  return (
    b.includes("cf-challenge") ||
    b.includes("cf-turnstile") ||
    b.includes("just a moment") ||
    b.includes("checking your browser") ||
    b.includes("enable javascript and cookies to continue") ||
    b.includes("verify you are human") ||
    (b.includes("captcha") && b.length < 8000)
  )
}

/** Fetch a URL with Scrapling's stealthy fetcher, solving Cloudflare. */
export function stealthFetch(
  url: string,
  opts: { cssSelector?: string; format?: "md" | "txt" | "html"; timeoutMs?: number } = {},
): Promise<StealthResult> {
  const format = opts.format ?? "md"
  const timeoutMs = opts.timeoutMs ?? 120_000
  const dir = mkdtempSync(join(tmpdir(), "spectra-scrapling-"))
  const outFile = join(dir, `page.${format}`)

  const args = ["extract", "stealthy-fetch", url, outFile, "--solve-cloudflare"]
  if (opts.cssSelector) args.push("--css-selector", opts.cssSelector)

  return new Promise<StealthResult>((resolve) => {
    const child = spawn("scrapling", args, { stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      child.kill("SIGKILL")
    }, timeoutMs)

    child.stderr?.on("data", (c: Buffer) => (stderr += c.toString()))
    child.on("error", (err) => {
      clearTimeout(timer)
      cleanup(dir)
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        resolve({ ok: false, missing: true, output: SCRAPLING_INSTALL_HINT })
      } else {
        resolve({ ok: false, output: `Scrapling failed: ${err.message}` })
      }
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (killed) {
        cleanup(dir)
        return resolve({ ok: false, output: `Scrapling timed out after ${timeoutMs}ms` })
      }
      let content = ""
      try {
        if (existsSync(outFile)) content = readFileSync(outFile, "utf-8")
      } catch {
        /* ignore */
      }
      cleanup(dir)
      if (code === 0 && content) return resolve({ ok: true, output: content })
      resolve({ ok: false, output: stderr.trim() || `Scrapling exited with code ${code}` })
    })
  })
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}
