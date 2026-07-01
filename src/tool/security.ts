/**
 * security_scan — a deterministic security baseline.
 *
 * The `security` agent is otherwise an LLM reviewer; this tool gives it (and
 * the user) hard, repeatable signal: a dependency vulnerability audit
 * (npm audit / pip-audit when available) plus a regex scan for hardcoded
 * secrets. It writes a report to `.spectra/security-report.md` and returns it,
 * so the agent can use it as a baseline and re-run it after fixes to confirm.
 */

import { spawn } from "node:child_process"
import { existsSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { collectSourceFiles } from "../autorun/verify.js"

export type Severity = "critical" | "high" | "medium"

export interface SecretFinding {
  file: string
  line: number
  kind: string
  severity: Severity
  snippet: string
}

const SECRET_RULES: { kind: string; re: RegExp; severity: Severity }[] = [
  { kind: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/, severity: "critical" },
  { kind: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, severity: "critical" },
  { kind: "GitHub token", re: /\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/, severity: "critical" },
  { kind: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, severity: "high" },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/, severity: "high" },
  {
    kind: "Hardcoded secret",
    re: /\b(?:api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key|client[_-]?secret)\b\s*[:=]\s*["'`][^"'`]{8,}["'`]/i,
    severity: "high",
  },
]

/** Things that indicate a value is NOT a real hardcoded secret. */
const NOT_A_SECRET = /process\.env|import\.meta\.env|os\.environ|getenv|\{env:|\$\{|<[^>]+>|x{4,}|example|placeholder|your[-_ ]|changeme|dummy|sample|redacted|\*{3,}/i

/** Pure regex scan for likely hardcoded secrets. */
export function scanSecrets(files: Record<string, string>): SecretFinding[] {
  const out: SecretFinding[] = []
  for (const [file, content] of Object.entries(files)) {
    const lines = content.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      for (const rule of SECRET_RULES) {
        if (!rule.re.test(line)) continue
        // The generic "hardcoded secret" rule must ignore env/placeholder refs.
        if (rule.kind === "Hardcoded secret" && NOT_A_SECRET.test(line)) break
        out.push({ file, line: i + 1, kind: rule.kind, severity: rule.severity, snippet: line.trim().slice(0, 120) })
        break
      }
    }
  }
  return out
}

function run(cmd: string, args: string[], cwd: string, timeoutMs = 90_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { cwd, env: process.env })
    } catch {
      resolve({ code: 127, out: "" })
      return
    }
    let out = ""
    let killed = false
    const t = setTimeout(() => {
      killed = true
      child!.kill("SIGKILL")
    }, timeoutMs)
    child.stdout?.on("data", (c: Buffer) => (out += c.toString()))
    child.stderr?.on("data", (c: Buffer) => (out += c.toString()))
    child.on("error", () => {
      clearTimeout(t)
      resolve({ code: 127, out })
    })
    child.on("close", (code) => {
      clearTimeout(t)
      resolve({ code: killed ? 124 : code ?? 1, out })
    })
  })
}

async function depAudit(cwd: string): Promise<string[]> {
  const out: string[] = []
  if (existsSync(join(cwd, "package.json"))) {
    const r = await run("npm", ["audit", "--json"], cwd)
    if (r.code === 127) out.push("- JS: `npm` not available for dependency audit")
    else {
      try {
        const data = JSON.parse(r.out) as { metadata?: { vulnerabilities?: Record<string, number> } }
        const v = data.metadata?.vulnerabilities
        if (v) out.push(`- JS (npm audit): ${v["critical"] ?? 0} critical · ${v["high"] ?? 0} high · ${v["moderate"] ?? 0} moderate · ${v["low"] ?? 0} low`)
        else out.push("- JS (npm audit): ran (no metadata; ensure a lockfile exists)")
      } catch {
        out.push("- JS (npm audit): could not parse results (run `npm install` first?)")
      }
    }
  }
  if (existsSync(join(cwd, "requirements.txt")) || existsSync(join(cwd, "pyproject.toml"))) {
    const r = await run("pip-audit", ["-f", "json"], cwd)
    if (r.code === 127) out.push("- Python: `pip-audit` not installed (`pip install pip-audit`) for dependency audit")
    else {
      try {
        const d = JSON.parse(r.out) as { dependencies?: { vulns?: unknown[] }[] } | unknown[]
        const n = Array.isArray(d) ? d.length : (d.dependencies ?? []).filter((x) => (x.vulns ?? []).length > 0).length
        out.push(`- Python (pip-audit): ${n} vulnerable package(s)`)
      } catch {
        out.push("- Python (pip-audit): ran")
      }
    }
  }
  if (out.length === 0) out.push("- No JS/Python dependency manifest found")
  return out
}

export const securityScanTool: Tool = {
  name: "security_scan",
  description:
    "Run a deterministic security baseline: dependency vulnerability audit (npm audit / pip-audit when available) " +
    "plus a regex scan for hardcoded secrets. Writes .spectra/security-report.md and returns it. " +
    "Use it FIRST in a security audit, and AGAIN after fixes to confirm they're gone.",
  category: "read",
  availableToSubagents: true,
  parameters: objectSchema({}, []),

  async execute(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const root = ctx.projectRoot
    const secrets = scanSecrets(collectSourceFiles(root, 800))
    const deps = await depAudit(root)

    const lines: string[] = [
      "# Security scan (deterministic baseline)",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      "## Dependency vulnerabilities",
      ...deps,
      "",
      `## Hardcoded secrets (${secrets.length})`,
    ]
    if (secrets.length === 0) lines.push("None detected by the regex scan.")
    else for (const s of secrets) lines.push(`- [${s.severity.toUpperCase()}] ${s.file}:${s.line} — ${s.kind}: \`${s.snippet}\``)
    lines.push("", "_Baseline only — combine with the agent's code review for full coverage._")
    const report = lines.join("\n")

    try {
      mkdirSync(join(root, ".spectra"), { recursive: true })
      writeFileSync(join(root, ".spectra", "security-report.md"), report, "utf-8")
    } catch {
      /* best-effort */
    }

    ctx.report(`security_scan: ${secrets.length} secret finding(s) · saved .spectra/security-report.md`)
    return { success: true, output: report, metadata: { secrets: secrets.length } }
  },
}
