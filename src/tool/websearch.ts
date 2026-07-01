/**
 * websearch — search the web and return ranked results (title, url, snippet).
 *
 * Complements `webfetch` (which needs a known URL): this lets the agent DISCOVER
 * pages. Works with no API key via DuckDuckGo's HTML endpoint; if TAVILY_API_KEY
 * or BRAVE_API_KEY is set, it uses that provider for higher-quality results.
 */

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .trim()
}

/** Parse DuckDuckGo's HTML results page into structured results. */
export function parseDuckDuckGo(html: string, limit: number): SearchResult[] {
  const out: SearchResult[] = []
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  const snippets: string[] = []
  let sm: RegExpExecArray | null
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(decodeEntities(sm[1]!))
  let m: RegExpExecArray | null
  let i = 0
  while ((m = linkRe.exec(html)) !== null && out.length < limit) {
    let href = m[1]!
    // DDG wraps links as //duckduckgo.com/l/?uddg=<encoded>&…
    const uddg = /[?&]uddg=([^&]+)/.exec(href)
    if (uddg) href = decodeURIComponent(uddg[1]!)
    if (href.startsWith("//")) href = "https:" + href
    const title = decodeEntities(m[2]!)
    if (title && /^https?:\/\//.test(href)) {
      out.push({ title, url: href, snippet: snippets[i] ?? "" })
    }
    i++
  }
  return out
}

async function searchTavily(query: string, key: string, count: number): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key, query, max_results: count }),
  })
  if (!res.ok) return []
  const body = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] }
  return (body.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }))
}

async function searchBrave(query: string, key: string, count: number): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`
  const res = await fetch(url, { headers: { "X-Subscription-Token": key, Accept: "application/json" } })
  if (!res.ok) return []
  const body = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } }
  return (body.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }))
}

async function searchDuckDuckGo(query: string, count: number): Promise<SearchResult[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  })
  if (!res.ok) return []
  return parseDuckDuckGo(await res.text(), count)
}

export const websearchTool: Tool = {
  name: "websearch",
  description:
    "Search the web for a query and return a ranked list of results (title, URL, snippet). " +
    "Use it to DISCOVER relevant pages, then `webfetch` a URL to read it. Works without an API key.",
  category: "web",
  availableToSubagents: true,
  parameters: objectSchema(
    {
      query: { type: "string", description: "The search query" },
      count: { type: "number", description: "Max results to return (default 6, max 10)" },
    },
    ["query"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const query = String(args["query"] ?? "").trim()
    if (!query) return { success: false, output: "Error: 'query' is required." }
    const count = Math.min(10, Math.max(1, Number(args["count"] ?? 6)))

    const level = ctx.permissionFor("websearch", query)
    if (level === "deny") return { success: false, output: `Error: web search denied.` }

    ctx.report(`🔎 websearch "${query}"`)

    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), 12_000)
    try {
      let results: SearchResult[] = []
      const tavily = process.env["TAVILY_API_KEY"]
      const brave = process.env["BRAVE_API_KEY"]
      if (tavily) results = await searchTavily(query, tavily, count)
      else if (brave) results = await searchBrave(query, brave, count)
      if (results.length === 0) results = await searchDuckDuckGo(query, count)

      if (results.length === 0) {
        return { success: false, output: `No results for "${query}" (the search endpoint may be rate-limited).` }
      }
      const text = results
        .slice(0, count)
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`)
        .join("\n\n")
      return { success: true, output: `Web results for "${query}":\n\n${text}`, metadata: { count: results.length } }
    } catch (err) {
      return { success: false, output: `Web search failed: ${(err as Error).message}` }
    } finally {
      clearTimeout(timer)
    }
  },
}
