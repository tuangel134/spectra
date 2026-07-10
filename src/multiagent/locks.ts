import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { conflictingClaims, multiagentStateDir, normalizeClaims } from "./paths.js"
import type { TaskLease } from "./types.js"

interface PersistedLocks {
  version: 1
  locks: TaskLease[]
}

function sleep(ms: number): void {
  const buffer = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(buffer), 0, 0, ms)
}

export class FileLockManager {
  readonly statePath: string
  private readonly mutexPath: string

  constructor(projectRoot: string) {
    const dir = multiagentStateDir(projectRoot)
    this.statePath = join(dir, "locks.json")
    this.mutexPath = join(dir, ".locks-mutex")
    mkdirSync(dir, { recursive: true })
  }

  list(now = Date.now()): TaskLease[] {
    return this.withMutex(() => {
      const state = this.read()
      const active = state.locks.filter((lock) => lock.expiresAt > now)
      if (active.length !== state.locks.length) this.write({ version: 1, locks: active })
      return active
    })
  }

  acquire(owner: string, claims: string[], ttlMs = 10 * 60_000, now = Date.now()): TaskLease {
    if (!owner.trim()) throw new Error("Lock owner is required")
    const normalized = normalizeClaims(claims)
    return this.withMutex(() => {
      const state = this.read()
      state.locks = state.locks.filter((lock) => lock.expiresAt > now && lock.owner !== owner)
      for (const lock of state.locks) {
        const overlap = conflictingClaims(normalized, lock.claims)
        if (overlap.length > 0) {
          throw new Error(`Files are locked by ${lock.owner}: ${overlap.join(", ")}`)
        }
      }
      const lease: TaskLease = {
        owner,
        claims: normalized,
        acquiredAt: now,
        expiresAt: now + Math.max(5_000, ttlMs),
      }
      state.locks.push(lease)
      this.write(state)
      return lease
    })
  }

  renew(owner: string, ttlMs = 10 * 60_000, now = Date.now()): TaskLease | null {
    return this.withMutex(() => {
      const state = this.read()
      const lock = state.locks.find((item) => item.owner === owner && item.expiresAt > now)
      if (!lock) return null
      lock.expiresAt = now + Math.max(5_000, ttlMs)
      this.write(state)
      return lock
    })
  }

  release(owner: string): boolean {
    return this.withMutex(() => {
      const state = this.read()
      const before = state.locks.length
      state.locks = state.locks.filter((lock) => lock.owner !== owner)
      if (state.locks.length !== before) this.write(state)
      return state.locks.length !== before
    })
  }

  releasePrefix(prefix: string): number {
    return this.withMutex(() => {
      const state = this.read()
      const before = state.locks.length
      state.locks = state.locks.filter((lock) => !lock.owner.startsWith(prefix))
      const removed = before - state.locks.length
      if (removed > 0) this.write(state)
      return removed
    })
  }

  private read(): PersistedLocks {
    if (!existsSync(this.statePath)) return { version: 1, locks: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, "utf-8")) as PersistedLocks
      return { version: 1, locks: Array.isArray(parsed.locks) ? parsed.locks : [] }
    } catch {
      return { version: 1, locks: [] }
    }
  }

  private write(state: PersistedLocks): void {
    mkdirSync(dirname(this.statePath), { recursive: true })
    const temp = `${this.statePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 })
    renameSync(temp, this.statePath)
  }

  private withMutex<T>(operation: () => T): T {
    const started = Date.now()
    while (true) {
      try {
        mkdirSync(this.mutexPath)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        try {
          if (Date.now() - statSync(this.mutexPath).mtimeMs > 15_000) rmSync(this.mutexPath, { recursive: true, force: true })
        } catch { /* another process released it */ }
        if (Date.now() - started > 5_000) throw new Error("Timed out waiting for multi-agent file lock")
        sleep(20)
      }
    }
    try {
      return operation()
    } finally {
      rmSync(this.mutexPath, { recursive: true, force: true })
    }
  }
}
