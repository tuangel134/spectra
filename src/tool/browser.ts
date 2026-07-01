/**
 * Browser tool — headless navigation + screenshots (Playwright, optional).
 *
 * Powers visual QA: the agent can open a URL, read the rendered text, or take a
 * screenshot. Playwright is an optional dependency loaded lazily; when it isn't
 * installed we return clear setup guidance instead of failing opaquely.
 *
 * Screenshots are returned as base64 PNG in metadata so the autopilot's visual
 * verification can feed them to a vision-capable model.
 */

import { writeFileSync } from "node:fs"

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { truncate } from "./fs-helpers.js"

export const PLAYWRIGHT_HINT =
  "Playwright is not installed. Enable browser actions with:\n" +
  "  npm i -D playwright && npx playwright install chromium"

export interface CaptureResult {
  ok: boolean
  /** Base64-encoded PNG (no data: prefix). */
  base64?: string
  /** Rendered page text. */
  text?: string
  title?: string
  error?: string
  missing?: boolean
}

/** Lazily load Playwright's chromium, or report that it's missing. */
async function loadChromium(): Promise<{ chromium: { launch: (o?: unknown) => Promise<unknown> } } | null> {
  try {
    // Optional dependency — not bundled. The indirected specifier keeps the
    // TypeScript compiler from requiring playwright's types at build time.
    const specifier = "playwright"
    const mod = (await import(specifier)) as unknown as {
      chromium?: { launch: (o?: unknown) => Promise<unknown> }
    }
    return mod.chromium ? { chromium: mod.chromium } : null
  } catch {
    return null
  }
}

/**
 * Open a URL in headless chromium and capture text and/or a screenshot.
 * Returns `missing:true` when Playwright is not available.
 */
export async function capture(
  url: string,
  opts: { screenshot?: boolean; fullPage?: boolean; timeoutMs?: number } = {},
): Promise<CaptureResult> {
  const mod = await loadChromium()
  if (!mod) return { ok: false, missing: true, error: PLAYWRIGHT_HINT }

  let browser: { newPage: () => Promise<unknown>; close: () => Promise<void> } | undefined
  try {
    browser = (await mod.chromium.launch({ headless: true })) as typeof browser
    const page = (await browser!.newPage()) as {
      goto: (u: string, o?: unknown) => Promise<unknown>
      title: () => Promise<string>
      innerText: (s: string) => Promise<string>
      screenshot: (o?: unknown) => Promise<Buffer>
    }
    await page.goto(url, { waitUntil: "networkidle", timeout: opts.timeoutMs ?? 30_000 })
    const title = await page.title().catch(() => "")
    const text = await page.innerText("body").catch(() => "")
    let base64: string | undefined
    if (opts.screenshot) {
      const buf = await page.screenshot({ fullPage: opts.fullPage ?? false })
      base64 = Buffer.from(buf).toString("base64")
    }
    return { ok: true, base64, text, title }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    await browser?.close().catch(() => {})
  }
}

export const browserTool: Tool = {
  name: "browser",
  description:
    "Open a URL in a headless browser to verify a running web app. action='text' returns " +
    "the rendered page text; action='screenshot' saves a PNG and reports the path. Requires Playwright.",
  category: "web",
  parameters: objectSchema(
    {
      url: { type: "string", description: "URL to open (e.g. http://localhost:3000)" },
      action: { type: "string", enum: ["text", "screenshot"], description: "What to capture" },
      path: { type: "string", description: "Where to save the screenshot (for action=screenshot)" },
    },
    ["url"],
  ),
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const url = String(args["url"] ?? "")
    if (!/^https?:\/\//.test(url)) return { success: false, output: "Error: url must start with http(s)://" }
    const action = String(args["action"] ?? "text")

    const level = ctx.permissionFor("webfetch", url)
    if (level === "deny") return { success: false, output: `Error: browsing denied for ${url}` }

    ctx.report(`🌐 browser ${action} ${url}`)
    const result = await capture(url, { screenshot: action === "screenshot" })
    if (result.missing) return { success: false, output: PLAYWRIGHT_HINT }
    if (!result.ok) return { success: false, output: `Browser error: ${result.error}` }

    if (action === "screenshot" && result.base64) {
      const path = String(args["path"] ?? "screenshot.png")
      try {
        writeFileSync(path, Buffer.from(result.base64, "base64"))
      } catch {
        /* ignore write failure; base64 still in metadata */
      }
      return {
        success: true,
        output: `Screenshot of ${url} saved to ${path} (title: ${result.title || "?"}).`,
        metadata: { url, path, image: result.base64 },
      }
    }
    return { success: true, output: truncate(result.text ?? "", 20_000), metadata: { url, title: result.title } }
  },
}
