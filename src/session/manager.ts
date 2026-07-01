/**
 * Session manager.
 *
 * Owns the lifecycle of conversation sessions, message history, token usage,
 * and file-change snapshots for undo support.
 */

import type { ChatMessage } from "../provider/types.js"
import type { Session, Snapshot, FileChange, ToolLogEntry } from "./types.js"
import { generateId } from "../util/id.js"
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { join } from "node:path"

export class SessionManager {
  private readonly sessions = new Map<string, Session>()
  private readonly snapshots = new Map<string, Snapshot[]>()
  /** Ids of isolated/sub-sessions: never current, never persisted to disk. */
  private readonly ephemeral = new Set<string>()
  private currentId: string | null = null
  private persistDir: string | null = null

  /** Enable on-disk persistence (call after construction with the project root). */
  enablePersistence(projectRoot: string): void {
    this.persistDir = join(projectRoot, ".spectra", "sessions")
    mkdirSync(this.persistDir, { recursive: true })
    // Load existing sessions from disk and make the most recent one active, so
    // re-opening a project continues exactly where the user left off.
    try {
      let latest: Session | undefined
      for (const file of readdirSync(this.persistDir)) {
        if (!file.endsWith(".json")) continue
        try {
          const data = JSON.parse(readFileSync(join(this.persistDir, file), "utf-8")) as Session
          this.sessions.set(data.id, data)
          if (!latest || (data.updatedAt ?? 0) > (latest.updatedAt ?? 0)) latest = data
        } catch {
          /* skip corrupted session file */
        }
      }
      if (latest) this.currentId = latest.id
    } catch {
      /* ignore read errors */
    }
  }

  /** Persist a session to disk (debounced: at most once per 2s per session). */
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private persist(session: Session): void {
    if (!this.persistDir) return
    // Ephemeral (isolated) sessions are never written to disk.
    if (this.ephemeral.has(session.id)) return
    // Debounce: avoid writing on every single message in a fast tool-call loop.
    if (this.persistTimers.has(session.id)) return
    const dir = this.persistDir
    const timer = setTimeout(() => {
      this.persistTimers.delete(session.id)
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `${session.id}.json`), JSON.stringify(session), "utf-8")
      } catch {
        /* best-effort */
      }
    }, 2000)
    // Don't keep the process alive just for a pending session write.
    if (typeof timer === "object" && "unref" in timer) timer.unref()
    this.persistTimers.set(session.id, timer)
  }

  /** Force any pending debounced writes to disk now (call on exit). */
  flush(): void {
    if (!this.persistDir) return
    for (const id of [...this.persistTimers.keys()]) {
      const session = this.sessions.get(id)
      if (session) this.persistNow(session)
    }
  }

  /** Write a session to disk synchronously, cancelling any pending debounce. */
  private persistNow(session: Session): void {
    if (!this.persistDir || this.ephemeral.has(session.id)) return
    const timer = this.persistTimers.get(session.id)
    if (timer) {
      clearTimeout(timer)
      this.persistTimers.delete(session.id)
    }
    try {
      mkdirSync(this.persistDir, { recursive: true })
      writeFileSync(join(this.persistDir, `${session.id}.json`), JSON.stringify(session), "utf-8")
    } catch {
      /* best-effort */
    }
  }

  create(agentId: string, model: string, specId?: string, makeCurrent = true): Session {
    const now = Date.now()
    const session: Session = {
      id: generateId("ses"),
      title: "New Session",
      agentId,
      model,
      messages: [],
      createdAt: now,
      updatedAt: now,
      childIds: [],
      specId,
      usage: { inputTokens: 0, outputTokens: 0 },
      toolLogs: [],
      changedFiles: {},
    }
    this.sessions.set(session.id, session)
    // Isolated/sub-sessions (spec generation, subagents, autorun, bench) pass
    // makeCurrent=false so they don't hijack the user's active chat session,
    // and they are kept ephemeral (in-memory only, never persisted).
    if (makeCurrent) this.currentId = session.id
    else this.ephemeral.add(session.id)
    this.persist(session)
    return session
  }

  /** Make an existing session the active one. */
  setCurrent(id: string): boolean {
    if (!this.sessions.has(id)) return false
    this.currentId = id
    return true
  }

  /** Record a tool invocation for the Logs tab. */
  addToolLog(sessionId: string, log: Omit<ToolLogEntry, "id" | "timestamp">): void {
    const session = this.require(sessionId)
    session.toolLogs.push({ ...log, id: generateId("log"), timestamp: Date.now() })
    if (session.toolLogs.length > 500) session.toolLogs.shift()
  }

  /** Record a file change (latest content wins) for the Files/Diff tabs. */
  recordFileChange(sessionId: string, change: FileChange): void {
    const session = this.require(sessionId)
    const existing = session.changedFiles[change.path]
    session.changedFiles[change.path] = {
      path: change.path,
      // Keep the earliest "before" so the diff spans the whole session.
      before: existing ? existing.before : change.before,
      after: change.after,
    }
  }

  current(): Session | null {
    return this.currentId ? (this.sessions.get(this.currentId) ?? null) : null
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  addMessage(sessionId: string, message: ChatMessage): void {
    const session = this.require(sessionId)
    session.messages.push(message)
    session.updatedAt = Date.now()
    this.persist(session)
  }

  /** Replace the entire message list (used by context compaction). */
  setMessages(sessionId: string, messages: ChatMessage[]): void {
    const session = this.require(sessionId)
    session.messages = messages
    session.updatedAt = Date.now()
    // Compaction is an important, infrequent state change — persist it now (not
    // debounced) so a crash right after compaction can't lose the summary.
    this.persistNow(session)
  }

  addUsage(sessionId: string, input: number, output: number): void {
    const session = this.require(sessionId)
    session.usage.inputTokens += input
    session.usage.outputTokens += output
    this.persist(session)
  }

  setTitle(sessionId: string, title: string): void {
    this.require(sessionId).title = title
  }

  /** Change the model used by a session (e.g. after /model in the TUI). */
  setModel(sessionId: string, model: string): void {
    this.require(sessionId).model = model
  }

  createChild(parentId: string, agentId: string, model: string): Session {
    const child = this.create(agentId, model)
    child.parentId = parentId
    this.require(parentId).childIds.push(child.id)
    return child
  }

  /** Record a snapshot of file changes made during a message turn. */
  snapshot(sessionId: string, changes: FileChange[]): Snapshot {
    const session = this.require(sessionId)
    const snap: Snapshot = {
      id: generateId("snap"),
      messageIndex: session.messages.length,
      changes,
      timestamp: Date.now(),
    }
    const list = this.snapshots.get(sessionId) ?? []
    list.push(snap)
    this.snapshots.set(sessionId, list)
    return snap
  }

  /** Pop and return the most recent snapshot for undo. */
  popSnapshot(sessionId: string): Snapshot | null {
    const list = this.snapshots.get(sessionId)
    if (!list || list.length === 0) return null
    return list.pop() ?? null
  }

  /** All snapshots for a session, oldest first (the timeline). */
  timeline(sessionId: string): Snapshot[] {
    return [...(this.snapshots.get(sessionId) ?? [])]
  }

  /**
   * Remove and return every snapshot newer than (and excluding) `snapshotId`,
   * most-recent first — the caller reverts each to rewind to that point.
   * If `snapshotId` is omitted, returns all snapshots (full rewind).
   */
  rewindTo(sessionId: string, snapshotId?: string): Snapshot[] {
    const list = this.snapshots.get(sessionId)
    if (!list || list.length === 0) return []
    let idx = -1
    if (snapshotId) {
      idx = list.findIndex((s) => s.id === snapshotId)
      // Unknown id: do NOT fall back to a full wipe — that would silently
      // revert everything. Treat it as a no-op.
      if (idx === -1) return []
    }
    // Keep snapshots up to and including idx; pop the rest.
    const removed = list.splice(idx + 1)
    this.snapshots.set(sessionId, list)
    return removed.reverse()
  }

  list(): Session[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * The most recent persisted (non-ephemeral) session that has messages — the
   * one to resume when a project is re-opened. Null on a brand-new project.
   */
  resumable(): Session | null {
    return this.list().find((s) => !this.ephemeral.has(s.id) && s.messages.length > 0) ?? null
  }

  private require(id: string): Session {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`Session ${id} not found`)
    return session
  }
}
