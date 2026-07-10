import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import type { CoreEvent, CoreRecoverySummary } from "./protocol.js"

interface StatementLike {
  run(...args: unknown[]): unknown
  all(...args: unknown[]): unknown[]
  get(...args: unknown[]): unknown
}

interface DatabaseLike {
  exec(sql: string): void
  prepare(sql: string): StatementLike
  close(): void
}

interface StateStoreOptions {
  forceJsonl?: boolean
  now?: () => number
}

interface JsonMeta {
  version: 1
  values: Record<string, string>
  clients: Record<string, number>
}

function safeParseEvent(line: string): CoreEvent | null {
  try {
    const value = JSON.parse(line) as Partial<CoreEvent>
    if (typeof value.id !== "string" || typeof value.type !== "string" || typeof value.timestamp !== "number") return null
    return {
      id: value.id,
      type: value.type,
      timestamp: value.timestamp,
      ...(typeof value.runId === "string" ? { runId: value.runId } : {}),
      payload: value.payload && typeof value.payload === "object" ? value.payload as Record<string, unknown> : {},
    }
  } catch {
    return null
  }
}

export class CoreStateStore {
  readonly backend: "sqlite" | "jsonl"
  readonly baseDir: string
  private readonly now: () => number
  private readonly database: DatabaseLike | null
  private readonly eventsPath: string
  private readonly metaPath: string
  private closed = false

  constructor(projectRoot: string, options: StateStoreOptions = {}) {
    this.baseDir = join(projectRoot, ".spectra", "state")
    mkdirSync(this.baseDir, { recursive: true })
    this.eventsPath = join(this.baseDir, "core-events.jsonl")
    this.metaPath = join(this.baseDir, "core-meta.json")
    this.now = options.now ?? Date.now

    let database: DatabaseLike | null = null
    if (!options.forceJsonl) {
      try {
        const require = createRequire(import.meta.url)
        const sqlite = require("node:sqlite") as { DatabaseSync?: new (path: string) => DatabaseLike }
        if (sqlite.DatabaseSync) database = new sqlite.DatabaseSync(join(this.baseDir, "core.sqlite"))
      } catch {
        database = null
      }
    }

    this.database = database
    this.backend = database ? "sqlite" : "jsonl"
    if (database) this.initializeSqlite(database)
  }

  private initializeSqlite(database: DatabaseLike): void {
    database.exec("PRAGMA journal_mode=WAL")
    database.exec("PRAGMA synchronous=NORMAL")
    database.exec("PRAGMA busy_timeout=5000")
    database.exec(`
      CREATE TABLE IF NOT EXISTS core_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        run_id TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_core_events_timestamp ON core_events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_core_events_run_id ON core_events(run_id, timestamp DESC);
      CREATE TABLE IF NOT EXISTS core_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS core_clients (
        id TEXT PRIMARY KEY,
        last_seen INTEGER NOT NULL
      );
    `)
  }

  record(type: string, payload: Record<string, unknown> = {}, runId?: string): CoreEvent {
    this.ensureOpen()
    const event: CoreEvent = {
      id: `evt_${randomUUID()}`,
      type,
      timestamp: this.now(),
      ...(runId ? { runId } : {}),
      payload,
    }
    if (this.database) {
      this.database
        .prepare("INSERT INTO core_events(id, type, timestamp, run_id, payload) VALUES (?, ?, ?, ?, ?)")
        .run(event.id, event.type, event.timestamp, event.runId ?? null, JSON.stringify(event.payload))
    } else {
      appendFileSync(this.eventsPath, JSON.stringify(event) + "\n", "utf-8")
    }
    return event
  }

  recent(limit = 100): CoreEvent[] {
    this.ensureOpen()
    const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)))
    if (this.database) {
      const rows = this.database
        .prepare("SELECT id, type, timestamp, run_id AS runId, payload FROM core_events ORDER BY seq DESC LIMIT ?")
        .all(safeLimit) as Array<Record<string, unknown>>
      return rows.map((row) => ({
        id: String(row["id"]),
        type: String(row["type"]),
        timestamp: Number(row["timestamp"]),
        ...(typeof row["runId"] === "string" ? { runId: row["runId"] } : {}),
        payload: safeJsonObject(String(row["payload"] ?? "{}")),
      }))
    }
    if (!existsSync(this.eventsPath)) return []
    const lines = readFileSync(this.eventsPath, "utf-8").split(/\r?\n/).filter(Boolean)
    return lines.slice(-safeLimit).reverse().map(safeParseEvent).filter((event): event is CoreEvent => Boolean(event))
  }

  setMeta(key: string, value: string): void {
    this.ensureOpen()
    if (this.database) {
      this.database
        .prepare("INSERT INTO core_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(key, value)
      return
    }
    const meta = this.readJsonMeta()
    meta.values[key] = value
    this.writeJsonMeta(meta)
  }

  getMeta(key: string): string | undefined {
    this.ensureOpen()
    if (this.database) {
      const row = this.database.prepare("SELECT value FROM core_meta WHERE key = ?").get(key) as { value?: unknown } | undefined
      return typeof row?.value === "string" ? row.value : undefined
    }
    return this.readJsonMeta().values[key]
  }

  heartbeatClient(clientId: string): void {
    this.ensureOpen()
    const timestamp = this.now()
    if (this.database) {
      this.database
        .prepare("INSERT INTO core_clients(id, last_seen) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen")
        .run(clientId, timestamp)
      return
    }
    const meta = this.readJsonMeta()
    meta.clients[clientId] = timestamp
    this.writeJsonMeta(meta)
  }

  activeClientCount(maxAgeMs = 15_000): number {
    this.ensureOpen()
    const cutoff = this.now() - maxAgeMs
    if (this.database) {
      this.database.prepare("DELETE FROM core_clients WHERE last_seen < ?").run(cutoff)
      const row = this.database.prepare("SELECT COUNT(*) AS count FROM core_clients").get() as { count?: unknown } | undefined
      return Number(row?.count ?? 0)
    }
    const meta = this.readJsonMeta()
    let changed = false
    for (const [id, seen] of Object.entries(meta.clients)) {
      if (seen < cutoff) {
        delete meta.clients[id]
        changed = true
      }
    }
    if (changed) this.writeJsonMeta(meta)
    return Object.keys(meta.clients).length
  }

  recoverySummary(resumableAutorun: boolean): CoreRecoverySummary {
    const events = this.recent(250)
    const latestByRun = new Map<string, CoreEvent>()
    for (const event of events) {
      if (event.runId && !latestByRun.has(event.runId)) latestByRun.set(event.runId, event)
    }
    let latestRunId: string | undefined
    let latestEvent: CoreEvent | undefined
    for (const [runId, event] of latestByRun) {
      if (!latestEvent || event.timestamp > latestEvent.timestamp) {
        latestRunId = runId
        latestEvent = event
      }
    }
    const terminalTypes = new Set(["run.completed", "run.cancelled", "run.failed"])
    const interrupted = Boolean(latestEvent && !terminalTypes.has(latestEvent.type)) || resumableAutorun
    return {
      interrupted,
      ...(latestRunId ? { latestRunId } : {}),
      ...(latestEvent ? { latestEvent } : {}),
      activeClients: this.activeClientCount(),
      resumableAutorun,
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.database?.close()
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("CoreStateStore is closed")
  }

  private readJsonMeta(): JsonMeta {
    if (!existsSync(this.metaPath)) return { version: 1, values: {}, clients: {} }
    try {
      const value = JSON.parse(readFileSync(this.metaPath, "utf-8")) as Partial<JsonMeta>
      return {
        version: 1,
        values: value.values && typeof value.values === "object" ? value.values : {},
        clients: value.clients && typeof value.clients === "object" ? value.clients : {},
      }
    } catch {
      return { version: 1, values: {}, clients: {} }
    }
  }

  private writeJsonMeta(meta: JsonMeta): void {
    mkdirSync(dirname(this.metaPath), { recursive: true })
    const tmp = `${this.metaPath}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(meta, null, 2) + "\n", "utf-8")
    renameSync(tmp, this.metaPath)
  }
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
