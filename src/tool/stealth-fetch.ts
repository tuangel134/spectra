/**
 * stealth_fetch — fetch pages behind Cloudflare / CAPTCHA via Scrapling.
 *
 * Use this when a normal `webfetch` is blocked (403/429, "just a moment",
 * Turnstile, etc.). It drives Scrapling's StealthyFetcher to render the page
 * with a real browser and solve the challenge, returning clean Markdown/text.
 */

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { truncate } from "./fs-helpers.js"
import { stealthFetch } from "./scrapling.js"

const MAX_OUTPUT = 30_000

export const stealthFetchTool: Tool = {
  name: "stealth_fetch",
  description:
    "Fetch a URL that is protected by Cloudflare or a CAPTCHA wall, using a real " +
    "stealth browser (Scrapling). Returns readable Markdown. Use when webfetch is blocked.",
  category: "web",
  parameters: objectSchema(
    {
      url: { type: "string", description: "The URL to fetch" },
      cssSelector: { type: "string", description: "Optional CSS selector to extract only matching content" },
      format: { type: "string", enum: ["md", "txt", "html"], description: "Output format (default md)" },
    },
    ["url"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const url = String(args["url"] ?? "")
    if (!/^https?:\/\//.test(url)) {
      return { success: false, output: "Error: url must start with http(s)://" }
    }

    const level = ctx.permissionFor("webfetch", url)
    if (level === "deny") return { success: false, output: `Error: webfetch denied for ${url}` }
    if (level === "ask") {
      const ok = await ctx.requestApproval("stealth_fetch", `Stealth-fetch ${url}`)
      if (!ok) return { success: false, output: `Stealth fetch of ${url} rejected by user.` }
    }

    ctx.report(`🛡️ stealth fetch ${url}`)
    const format = (args["format"] as "md" | "txt" | "html" | undefined) ?? "md"
    const cssSelector = args["cssSelector"] ? String(args["cssSelector"]) : undefined

    const result = await stealthFetch(url, { format, cssSelector })
    if (!result.ok) {
      return { success: false, output: result.output }
    }
    return { success: true, output: truncate(result.output, MAX_OUTPUT), metadata: { url, stealth: true } }
  },
}
