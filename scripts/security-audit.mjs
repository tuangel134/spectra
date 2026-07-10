#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import * as ts from "typescript"

const root = fileURLToPath(new URL("../", import.meta.url))
const findings = []
const excluded = new Set(["node_modules", "dist", ".git", ".spectra-upgrade-backup"])

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (excluded.has(name)) continue
    const file = join(dir, name)
    const stat = statSync(file)
    if (stat.isDirectory()) walk(file)
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|yml|yaml|sh|ps1|rs)$/.test(name)) scan(file)
  }
}

function scriptKind(file) {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX
  if (/\.[cm]?js$/i.test(file)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return ""
}

function scanExecutableJavaScript(file, source, rel) {
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) return
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file))
  let evalReported = false
  let functionReported = false
  const visit = (node) => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === "eval" && !evalReported) {
      findings.push(`${rel}: eval usage`)
      evalReported = true
    }
    if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && calleeName(node.expression) === "Function" && !functionReported) {
      findings.push(`${rel}: dynamic Function usage`)
      functionReported = true
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
}

function scan(file) {
  const source = readFileSync(file, "utf8")
  const rel = relative(root, file)
  if (rel === "scripts/security-audit.mjs") return

  const rules = [
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key committed"],
    [/ghp_[A-Za-z0-9]{20,}/, "GitHub token committed"],
  ]
  if (rel.startsWith(`src${process.platform === "win32" ? "\\" : "/"}web`) || rel.startsWith("src/web")) {
    rules.push([/<script[^>]+src=["']https?:/i, "remote script in bundled UI"])
    rules.push([/<link[^>]+href=["']https?:/i, "remote stylesheet in bundled UI"])
    rules.push([/https?:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|esm\.sh)\//i, "public CDN reference in bundled UI"])
  }
  for (const [pattern, message] of rules) if (pattern.test(source)) findings.push(`${rel}: ${message}`)
  scanExecutableJavaScript(file, source, rel)
}

walk(join(root, "src"))
walk(join(root, "scripts"))
walk(join(root, "desktop-native"))
if (findings.length) {
  console.error(findings.join("\n"))
  process.exit(1)
}
try {
  execFileSync("npm", ["audit", "--omit=dev", "--audit-level=high"], { cwd: root, stdio: "inherit" })
} catch {
  process.exit(1)
}
console.log("Production security audit passed.")
