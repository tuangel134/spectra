import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join, relative, resolve, sep } from "node:path"

const GLOB_RE = /[*?[]/

export function normalizeClaim(input: string): string {
  let value = input.trim().replaceAll("\\", "/")
  while (value.startsWith("./")) value = value.slice(2)
  value = value.replace(/\/{2,}/g, "/").replace(/\/$/, "")
  if (!value || value === ".") return "**"
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value) || value.split("/").includes("..")) {
    throw new Error(`Invalid file claim: ${input}`)
  }
  return value
}

export function normalizeClaims(claims: string[]): string[] {
  const values = (claims.length > 0 ? claims : ["**"]).map(normalizeClaim)
  return [...new Set(values)].sort()
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|\\]/g, "\\$&")
}

export function claimToRegex(claim: string): RegExp {
  const normalized = normalizeClaim(claim)
  if (normalized === "**" || normalized === "*") return /^.*$/
  let pattern = ""
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!
    if (ch === "*" && normalized[i + 1] === "*") {
      pattern += ".*"
      i++
    } else if (ch === "*") {
      pattern += "[^/]*"
    } else if (ch === "?") {
      pattern += "[^/]"
    } else {
      pattern += escapeRegex(ch)
    }
  }
  return new RegExp(`^${pattern}(?:/.*)?$`)
}

export function claimMatchesPath(claim: string, file: string): boolean {
  const normalizedFile = normalizeClaim(file)
  const normalizedClaim = normalizeClaim(claim)
  if (!GLOB_RE.test(normalizedClaim)) {
    return normalizedFile === normalizedClaim || normalizedFile.startsWith(`${normalizedClaim}/`)
  }
  return claimToRegex(normalizedClaim).test(normalizedFile)
}

function literalPrefix(claim: string): string {
  const normalized = normalizeClaim(claim)
  const index = normalized.search(GLOB_RE)
  return (index === -1 ? normalized : normalized.slice(0, index)).replace(/\/$/, "")
}

export function claimsOverlap(left: string, right: string): boolean {
  const a = normalizeClaim(left)
  const b = normalizeClaim(right)
  if ([a, b].includes("**") || [a, b].includes("*")) return true
  if (claimMatchesPath(a, b) || claimMatchesPath(b, a)) return true
  const ap = literalPrefix(a)
  const bp = literalPrefix(b)
  return Boolean(ap && bp && (ap === bp || ap.startsWith(`${bp}/`) || bp.startsWith(`${ap}/`)))
}

export function conflictingClaims(left: string[], right: string[]): string[] {
  const result: string[] = []
  for (const a of normalizeClaims(left)) {
    for (const b of normalizeClaims(right)) {
      if (claimsOverlap(a, b)) result.push(`${a} ↔ ${b}`)
    }
  }
  return result
}

export function claimsAllowFile(claims: string[], file: string): boolean {
  return normalizeClaims(claims).some((claim) => claimMatchesPath(claim, file))
}

export function safeRelative(root: string, absolute: string): string {
  const rootResolved = resolve(root)
  const value = resolve(absolute)
  const rel = relative(rootResolved, value)
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === "..") {
    if (rel === "") return ""
    throw new Error(`Path escapes project root: ${absolute}`)
  }
  return rel.replaceAll("\\", "/")
}


export function multiagentStateDir(projectRoot: string): string {
  const root = resolve(projectRoot)
  const key = createHash("sha256").update(root).digest("hex").slice(0, 24)
  const stateHome = process.platform === "win32"
    ? (process.env["LOCALAPPDATA"] ?? process.env["APPDATA"] ?? join(homedir(), "AppData", "Local"))
    : (process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state"))
  return join(stateHome, "spectra", "multiagent", key)
}
