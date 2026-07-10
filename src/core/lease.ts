import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { configDir } from "../util/platform.js"
import type { CoreLease } from "./protocol.js"

function canonicalProjectRoot(projectRoot: string): string {
  const result = resolve(projectRoot)
  return process.platform === "win32" ? result.toLowerCase() : result
}

export function coreProjectKey(projectRoot: string): string {
  return createHash("sha256").update(canonicalProjectRoot(projectRoot)).digest("hex").slice(0, 24)
}

export function coreLeasePath(projectRoot: string): string {
  return join(configDir(), "core", `${coreProjectKey(projectRoot)}.json`)
}

export function writeCoreLease(projectRoot: string, lease: CoreLease): void {
  const path = coreLeasePath(projectRoot)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(lease, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
  renameSync(tmp, path)
}

export function readCoreLease(projectRoot: string): CoreLease | null {
  const path = coreLeasePath(projectRoot)
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, "utf-8")) as Partial<CoreLease>
    if (
      typeof value.protocolVersion !== "number" ||
      typeof value.instanceId !== "string" ||
      typeof value.pid !== "number" ||
      typeof value.port !== "number" ||
      value.hostname !== "127.0.0.1" ||
      typeof value.projectRoot !== "string" ||
      typeof value.startedAt !== "number" ||
      typeof value.heartbeatAt !== "number" ||
      (value.stateBackend !== "sqlite" && value.stateBackend !== "jsonl")
    ) {
      return null
    }
    return value as CoreLease
  } catch {
    return null
  }
}

export function removeCoreLease(projectRoot: string, expectedInstanceId?: string): void {
  const path = coreLeasePath(projectRoot)
  if (expectedInstanceId) {
    const current = readCoreLease(projectRoot)
    if (current && current.instanceId !== expectedInstanceId) return
  }
  rmSync(path, { force: true })
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
