/**
 * Auto-growing regression evals.
 *
 * When the Full-Stack autopilot fixes a bug and the project goes green, it
 * records the verification commands that now pass as regression cases in
 * `.spectra/evals/regressions.json`. Future `spectra eval` runs re-run them, so
 * the suite grows itself and guards against the same bug returning.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { spawnSync } from "node:child_process"

import type { EvalCase, EvalResult } from "./index.js"

export interface RegressionCase {
  name: string
  command: string
  createdAt: number
}

function storePath(projectRoot: string): string {
  return join(projectRoot, ".spectra", "evals", "regressions.json")
}

export function loadRegressions(projectRoot: string): RegressionCase[] {
  const path = storePath(projectRoot)
  if (!existsSync(path)) return []
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as { cases?: RegressionCase[] }
    return Array.isArray(data.cases) ? data.cases : []
  } catch {
    return []
  }
}

function save(projectRoot: string, cases: RegressionCase[]): void {
  const path = storePath(projectRoot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ cases }, null, 2), "utf-8")
}

/** Add regression cases for commands that now pass (de-duplicated by command). */
export function addRegressions(projectRoot: string, commands: string[]): RegressionCase[] {
  const existing = loadRegressions(projectRoot)
  const seen = new Set(existing.map((c) => c.command))
  for (const command of commands) {
    if (!command.trim() || seen.has(command)) continue
    existing.push({ name: `regression: ${command}`, command, createdAt: Date.now() })
    seen.add(command)
  }
  save(projectRoot, existing)
  return existing
}

/** Turn stored regressions into runnable eval cases. */
export function regressionCases(projectRoot: string): EvalCase[] {
  return loadRegressions(projectRoot).map((rc): EvalCase => {
    return (): EvalResult => {
      const res = spawnSync(process.env["SHELL"] || "/bin/bash", ["-c", rc.command], {
        cwd: projectRoot,
        encoding: "utf-8",
        timeout: 600_000,
      })
      // A timeout (or spawn failure) leaves status === null; report it clearly
      // instead of the misleading "exit null".
      if (res.error || res.status === null) {
        const timedOut = (res.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" || res.signal === "SIGTERM"
        return {
          name: rc.name,
          pass: false,
          score: 0,
          detail: timedOut
            ? "timed out after 600s"
            : `failed to run: ${res.error?.message ?? "no exit status"}`,
        }
      }
      const pass = res.status === 0
      return {
        name: rc.name,
        pass,
        score: pass ? 1 : 0,
        detail: pass ? "passes" : `exit ${res.status}: ${(res.stderr || res.stdout || "").trim().slice(-200)}`,
      }
    }
  })
}
