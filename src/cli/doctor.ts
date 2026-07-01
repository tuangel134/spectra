/**
 * `spectra doctor` — environment & configuration health check.
 *
 * Verifies the things that commonly break a fresh setup (Node version, git,
 * ripgrep, a valid config, a resolvable model with credentials, a writable
 * config dir) and prints ✓ / ⚠ / ✗ with a concrete fix for anything wrong.
 */

import { stdout } from "node:process"
import { spawnSync } from "node:child_process"
import { accessSync, mkdirSync, constants as FS } from "node:fs"

import type { Runtime } from "../runtime.js"
import { color, BRAND } from "../util/logger.js"
import { configDir, IS_WINDOWS } from "../util/platform.js"

type Status = "ok" | "warn" | "fail"
interface Check {
  status: Status
  label: string
  detail: string
}

function has(bin: string, arg = "--version"): boolean {
  try {
    return spawnSync(bin, [arg], { encoding: "utf-8" }).status === 0
  } catch {
    return false
  }
}

/** Run all checks and print a report. Returns a process exit code (0 = healthy). */
export function runDoctor(rt: Runtime): number {
  const checks: Check[] = []
  const add = (status: Status, label: string, detail: string): void => {
    checks.push({ status, label, detail })
  }

  // Node version
  const nodeMajor = Number(process.versions.node.split(".")[0])
  add(
    nodeMajor >= 20 ? "ok" : "fail",
    `Node.js ${process.versions.node}`,
    nodeMajor >= 20 ? "meets >= 20" : "Spectra requires Node.js >= 20 — upgrade from nodejs.org",
  )

  // git
  add(has("git") ? "ok" : "fail", "git", has("git") ? "found" : "install git (needed by the git tools & updates)")

  // ripgrep (optional)
  add(
    has("rg") ? "ok" : "warn",
    "ripgrep (rg)",
    has("rg") ? "found" : "optional — grep/glob fall back to a slower scan without it",
  )

  // Project root
  add("ok", "Project root", rt.config.projectRoot)

  // Config dir writable
  const dir = configDir()
  try {
    mkdirSync(dir, { recursive: true })
    accessSync(dir, FS.W_OK)
    add("ok", "Config dir", dir)
  } catch {
    add("fail", "Config dir", `${dir} is not writable — check permissions`)
  }

  // Active model resolves + credentials
  const model = rt.config.config.model
  try {
    const resolved = rt.providers.resolve(model)
    const free = resolved.providerId === "free"
    const hasCreds = free || rt.providers.hasCredentials(resolved.providerId)
    add(
      hasCreds ? "ok" : "warn",
      `Model ${model}`,
      hasCreds
        ? free
          ? "free tier — works with no API key"
          : `provider "${resolved.providerId}" has credentials`
        : `no API key for "${resolved.providerId}" — run /connect or set its env key`,
    )
  } catch (err) {
    add("fail", `Model ${model}`, `cannot resolve: ${(err as Error).message}`)
  }

  // Desktop native binary (informational)
  const exe = IS_WINDOWS ? "spectra-desktop.exe" : "spectra-desktop"
  add(
    "ok",
    "Desktop",
    `'spectra desktop' works via browser fallback; native binary (${exe}) auto-downloads on first run`,
  )

  // ---- print ----
  stdout.write(`${BRAND} ${color.gray("environment health check")}\n\n`)
  const icon = (s: Status): string =>
    s === "ok" ? color.green("✓") : s === "warn" ? color.yellow("⚠") : color.red("✗")
  for (const c of checks) {
    stdout.write(`  ${icon(c.status)} ${color.bold(c.label.padEnd(22))} ${color.gray(c.detail)}\n`)
  }

  const fails = checks.filter((c) => c.status === "fail").length
  const warns = checks.filter((c) => c.status === "warn").length
  stdout.write(
    `\n  ${fails === 0 ? color.green("Healthy") : color.red(`${fails} problem(s)`)}` +
      (warns ? color.yellow(` · ${warns} warning(s)`) : "") +
      "\n",
  )
  return fails > 0 ? 1 : 0
}
