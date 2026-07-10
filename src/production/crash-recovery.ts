import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { configDir } from "../util/platform.js"
import type { RecoveryRecord } from "./types.js"

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

export function projectRecoveryKey(projectRoot: string): string {
  return createHash("sha256").update(resolve(projectRoot)).digest("hex").slice(0, 24)
}

export class CrashRecoveryJournal {
  readonly projectRoot: string
  readonly projectKey: string
  readonly file: string
  constructor(projectRoot: string, private readonly version = "1.0.0", root = join(configDir(), "recovery")) {
    this.projectRoot = resolve(projectRoot)
    this.projectKey = projectRecoveryKey(this.projectRoot)
    this.file = join(root, `${this.projectKey}.json`)
  }
  read(): RecoveryRecord | null {
    if (!existsSync(this.file)) return null
    try {
      const record = JSON.parse(readFileSync(this.file, "utf8")) as RecoveryRecord
      return record.schemaVersion === 1 && record.projectKey === this.projectKey ? record : null
    } catch { return null }
  }
  interrupted(): RecoveryRecord | null {
    const record = this.read()
    if (!record || record.clean || isAlive(record.pid)) return null
    return record
  }
  begin(instanceId: string, pid = process.pid): RecoveryRecord | null {
    const previous = this.interrupted()
    const now = Date.now()
    this.write({ schemaVersion: 1, projectRoot: this.projectRoot, projectKey: this.projectKey, version: this.version, pid, instanceId, startedAt: now, heartbeatAt: now, clean: false })
    return previous
  }
  heartbeat(): void {
    const current = this.read()
    if (current && current.pid === process.pid) this.write({ ...current, heartbeatAt: Date.now() })
  }
  fail(reason: string, error?: unknown): void {
    const current = this.read()
    const now = Date.now()
    this.write({ ...(current ?? { schemaVersion: 1, projectRoot: this.projectRoot, projectKey: this.projectKey, version: this.version, pid: process.pid, instanceId: "unknown", startedAt: now }), heartbeatAt: now, clean: false, reason, error: error instanceof Error ? error.stack ?? error.message : error === undefined ? undefined : String(error) })
  }
  clean(reason = "clean-shutdown"): void {
    const current = this.read()
    if (current) this.write({ ...current, heartbeatAt: Date.now(), clean: true, reason, error: undefined })
  }
  acknowledge(): boolean { if (!existsSync(this.file)) return false; rmSync(this.file, { force: true }); return true }
  private write(record: RecoveryRecord): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = this.file + ".tmp"
    writeFileSync(temporary, JSON.stringify(record, null, 2), { mode: 0o600 })
    renameSync(temporary, this.file)
    try { chmodSync(this.file, 0o600) } catch { /* Windows */ }
  }
}
