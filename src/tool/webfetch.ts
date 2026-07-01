import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { truncate } from "./fs-helpers.js"
import { looksBlocked, scraplingAvailable, stealthFetch } from "./scrapling.js"

const MAX_OUTPUT = 30_000

/** Very small HTML-to-text reducer to keep output readable. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export const webfetchTool: Tool = {
  name: "webfetch",
  description: "Fetch the contents of a URL and return it as readable text.",
  category: "web",
  parameters: objectSchema(
    {
      url: { type: "string", description: "The HTTPS URL to fetch" },
    },
    ["url"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const url = String(args["url"] ?? "")
    if (!url) return { success: false, output: "Error: 'url' is required." }
    if (!/^https?:\/\//.test(url)) {
      return { success: false, output: "Error: url must start with http(s)://" }
    }

    const level = ctx.permissionFor("webfetch", url)
    if (level === "deny") {
      return { success: false, output: `Error: webfetch denied for ${url}` }
    }
    if (level === "ask") {
      const approved = await ctx.requestApproval("webfetch", `Fetch ${url}`)
      if (!approved) return { success: false, output: `Fetch of ${url} rejected by user.` }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)

    try {
      const response = await fetch(url, { signal: controller.signal })
      const contentType = response.headers.get("content-type") ?? ""
      const text = await response.text()
      const body = contentType.includes("html") ? htmlToText(text) : text

      // Anti-bot fallback: if the page is a Cloudflare/CAPTCHA wall, retry with
      // Scrapling's stealth browser (when it is installed).
      if (looksBlocked(response.status, text) && (await scraplingAvailable())) {
        ctx.report(`webfetch blocked (${response.status}); retrying with stealth fetch…`)
        const stealth = await stealthFetch(url, { format: "md" })
        if (stealth.ok) {
          return {
            success: true,
            output: truncate(stealth.output, MAX_OUTPUT),
            metadata: { status: response.status, stealth: true },
          }
        }
      }

      return {
        success: response.ok,
        output: truncate(body, MAX_OUTPUT),
        metadata: { status: response.status, contentType },
      }
    } catch (err) {
      return {
        success: false,
        output: `Failed to fetch ${url}: ${(err as Error).message}`,
      }
    } finally {
      clearTimeout(timer)
    }
  },
}
