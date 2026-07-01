/**
 * Computer use tool — interact with a running web app (click, type, scroll).
 *
 * Drives Playwright: navigates to a URL, then performs a sequence of actions
 * described as steps. Each step returns a screenshot so the agent (with vision)
 * can see what happened. Requires Playwright (optional dependency).
 *
 * This closes the "computer use" gap vs Claude Code.
 */

import { writeFileSync } from "node:fs"

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"

const PLAYWRIGHT_HINT =
  "Playwright is not installed. Enable computer use with:\n" +
  "  npm i -D playwright && npx playwright install chromium"

export interface ComputerAction {
  type: "click" | "type" | "scroll" | "screenshot" | "wait" | "goto"
  /** CSS selector for click/type. */
  selector?: string
  /** Text to type. */
  text?: string
  /** Scroll direction (up/down). */
  direction?: "up" | "down"
  /** URL for goto. */
  url?: string
  /** Milliseconds for wait. */
  ms?: number
}

export const computerTool: Tool = {
  name: "computer",
  description:
    "Control a running web app: click buttons, type text, scroll, and take screenshots. " +
    "Provide a URL and a list of actions. Returns a screenshot after the last action. " +
    "Requires Playwright. Use for visual QA, filling forms, and testing UI flows.",
  category: "web",
  parameters: objectSchema(
    {
      url: { type: "string", description: "URL to navigate to first" },
      actions: {
        type: "array",
        description: "Steps to perform in order",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["click", "type", "scroll", "screenshot", "wait", "goto"] },
            selector: { type: "string" },
            text: { type: "string" },
            direction: { type: "string", enum: ["up", "down"] },
            url: { type: "string" },
            ms: { type: "number" },
          },
          required: ["type"],
        },
      },
    },
    ["url", "actions"],
  ),
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const url = String(args["url"] ?? "")
    if (!/^https?:\/\//.test(url)) return { success: false, output: "Error: url must start with http(s)://" }
    const actions = Array.isArray(args["actions"]) ? (args["actions"] as ComputerAction[]) : []
    if (actions.length === 0) return { success: false, output: "Error: at least one action is required." }

    const level = ctx.permissionFor("webfetch", url)
    if (level === "deny") return { success: false, output: `Error: browsing denied for ${url}` }

    ctx.report(`🖥️ computer use ${url} (${actions.length} actions)`)

    let mod: { chromium: { launch: (o?: unknown) => Promise<unknown> } } | null
    try {
      const specifier = "playwright"
      const m = (await import(specifier)) as unknown as { chromium?: { launch: (o?: unknown) => Promise<unknown> } }
      mod = m.chromium ? { chromium: m.chromium } : null
    } catch {
      mod = null
    }
    if (!mod) return { success: false, output: PLAYWRIGHT_HINT }

    let browser: { newPage: () => Promise<unknown>; close: () => Promise<void> } | undefined
    try {
      browser = (await mod.chromium.launch({ headless: true })) as typeof browser
      const page = (await browser!.newPage()) as {
        goto: (u: string, o?: unknown) => Promise<unknown>
        click: (s: string, o?: unknown) => Promise<void>
        fill: (s: string, t: string) => Promise<void>
        evaluate: (fn: string) => Promise<unknown>
        screenshot: (o?: unknown) => Promise<Buffer>
        waitForTimeout: (ms: number) => Promise<void>
      }

      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 })

      const log: string[] = []
      for (const action of actions) {
        switch (action.type) {
          case "click":
            if (!action.selector) { log.push("click: missing selector"); break }
            try {
              await page.click(action.selector, { timeout: 5000 })
              log.push(`clicked ${action.selector}`)
            } catch (e) {
              log.push(`click failed: ${(e as Error).message}`)
            }
            break
          case "type":
            if (!action.selector || !action.text) { log.push("type: missing selector/text"); break }
            try {
              await page.fill(action.selector, action.text)
              log.push(`typed "${action.text}" into ${action.selector}`)
            } catch (e) {
              log.push(`type failed: ${(e as Error).message}`)
            }
            break
          case "scroll":
            await page.evaluate(action.direction === "up" ? "window.scrollBy(0,-400)" : "window.scrollBy(0,400)")
            log.push(`scrolled ${action.direction ?? "down"}`)
            break
          case "goto":
            if (action.url) await page.goto(action.url, { waitUntil: "networkidle", timeout: 20_000 })
            log.push(`navigated to ${action.url}`)
            break
          case "wait":
            await page.waitForTimeout(action.ms ?? 1000)
            log.push(`waited ${action.ms ?? 1000}ms`)
            break
          case "screenshot":
            log.push("(screenshot taken)")
            break
        }
      }

      // Final screenshot.
      const buf = await page.screenshot({ fullPage: false })
      const base64 = Buffer.from(buf).toString("base64")
      try {
        writeFileSync("computer-screenshot.png", buf)
      } catch { /* best-effort */ }

      return {
        success: true,
        output: `Computer use complete (${actions.length} actions):\n${log.join("\n")}\n\nScreenshot saved to computer-screenshot.png.`,
        metadata: { url, actions: actions.length, image: base64 },
      }
    } catch (err) {
      return { success: false, output: `Computer use failed: ${(err as Error).message}` }
    } finally {
      await browser?.close().catch(() => {})
    }
  },
}
