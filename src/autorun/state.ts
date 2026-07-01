/**
 * Autorun state persistence (checkpointing).
 *
 * The full run state is written to `.spectra/autorun/<id>/state.json` after
 * every meaningful step. This is what makes the mode crash-proof: if the
 * process dies, the watchdog (or a fresh launch) reloads the latest checkpoint
 * and resumes exactly where it left off.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { join } from "node:path"

import type { AutorunEvent, AutorunState, EventLevel } from "./types.js"
import { generateId } from "../util/id.js"

const MAX_EVENTS = 500

export class AutorunStore {
  private readonly baseDir: string

  constructor(projectRoot: string) {
    this.baseDir = join(projectRoot, ".spectra", "autorun")
  }

  private dir(id: string): string {
    return join(this.baseDir, id)
  }

  private statePath(id: string): string {
    return join(this.dir(id), "state.json")
  }

  /** Create a fresh run state for a goal and persist it. */
  create(goal: string): AutorunState {
    const now = Date.now()
    const state: AutorunState = {
      id: generateId("run"),
      goal,
      status: "planning",
      phases: [],
      currentPhase: 0,
      createdAt: now,
      updatedAt: now,
      heartbeatAt: now,
      recoveries: 0,
      stallCount: 0,
      events: [],
      finished: false,
    }
    this.save(state)
    return state
  }

  /** Persist the current state to disk. */
  save(state: AutorunState): void {
    state.updatedAt = Date.now()
    mkdirSync(this.dir(state.id), { recursive: true })
    writeFileSync(this.statePath(state.id), JSON.stringify(state, null, 2), "utf-8")
  }

  /** Load a specific run by id. */
  load(id: string): AutorunState | null {
    const path = this.statePath(id)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as AutorunState
    } catch {
      return null
    }
  }

  /** List all runs, most recent first. */
  list(): AutorunState[] {
    if (!existsSync(this.baseDir)) return []
    const states: AutorunState[] = []
    for (const entry of readdirSync(this.baseDir)) {
      const s = this.load(entry)
      if (s) states.push(s)
    }
    return states.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** The most recent run that has not finished — a candidate for resuming.
   *  A `failed` run (e.g. hit the attempts ceiling) is NOT auto-resumable:
   *  resuming it would just re-trip the same terminal condition. */
  latestResumable(): AutorunState | null {
    return this.list().find((s) => !s.finished && s.status !== "failed") ?? null
  }

  /** Append an event to a state (bounded ring) and persist. */
  pushEvent(state: AutorunState, level: EventLevel, message: string): AutorunEvent {
    const event: AutorunEvent = { ts: Date.now(), level, message }
    state.events.push(event)
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS)
    this.save(state)
    return event
  }
}
