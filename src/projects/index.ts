/**
 * Project manager.
 *
 * Tracks user projects in `~/.config/spectra/projects.json`. Each entry is a
 * directory path + metadata. The UI shows a project list with buttons to create,
 * open, switch, and remove projects. Switching a project restarts the runtime
 * against the new root.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from "node:fs"
import { join, dirname, basename } from "node:path"

import { configDir } from "../util/platform.js"

export interface ProjectEntry {
  path: string
  name: string
  createdAt: number
  lastOpenedAt: number
}

function storePath(): string {
  return join(configDir(), "projects.json")
}

function load(): ProjectEntry[] {
  const p = storePath()
  if (!existsSync(p)) return []
  try {
    const data = JSON.parse(readFileSync(p, "utf-8")) as { projects?: ProjectEntry[] }
    return Array.isArray(data.projects) ? data.projects : []
  } catch {
    return []
  }
}

function save(projects: ProjectEntry[]): void {
  const p = storePath()
  mkdirSync(dirname(p), { recursive: true })
  // Atomic write (temp + rename) so a crash mid-write can't corrupt the file.
  const tmp = p + ".tmp"
  writeFileSync(tmp, JSON.stringify({ projects }, null, 2), "utf-8")
  renameSync(tmp, p)
}

export class ProjectManager {
  private projects: ProjectEntry[]

  constructor() {
    this.projects = load()
  }

  list(): ProjectEntry[] {
    return [...this.projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  }

  /** Register (or re-register) a project path. */
  add(path: string, name?: string): ProjectEntry {
    const abs = path.startsWith("/") ? path : join(process.cwd(), path)
    const existing = this.projects.find((p) => p.path === abs)
    if (existing) {
      existing.lastOpenedAt = Date.now()
      existing.name = name ?? existing.name
      save(this.projects)
      return existing
    }
    const entry: ProjectEntry = {
      path: abs,
      name: name ?? basename(abs),
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    }
    this.projects.unshift(entry)
    save(this.projects)
    return entry
  }

  /** Remove a project from the list (does NOT delete files). */
  remove(path: string): boolean {
    // Normalize to an absolute path the same way add() does, so removing by the
    // same string that was added actually matches.
    const abs = path.startsWith("/") ? path : join(process.cwd(), path)
    const before = this.projects.length
    this.projects = this.projects.filter((p) => p.path !== abs && p.path !== path)
    if (this.projects.length !== before) {
      save(this.projects)
      return true
    }
    return false
  }

  /** Create a new directory and register it as a project. */
  create(parentDir: string, name: string): ProjectEntry {
    // Strip any path components so a name like "../evil" cannot escape parentDir.
    const safe = basename(name.trim())
    if (!safe || safe === "." || safe === "..") {
      throw new Error("Invalid project name.")
    }
    const abs = join(parentDir, safe)
    mkdirSync(abs, { recursive: true })
    // Initialize with a minimal structure.
    mkdirSync(join(abs, ".spectra"), { recursive: true })
    if (!existsSync(join(abs, "package.json"))) {
      writeFileSync(join(abs, "package.json"), JSON.stringify({ name: safe, version: "0.1.0", private: true }, null, 2))
    }
    return this.add(abs, safe)
  }

  /** Whether a path looks like a valid project directory. */
  isValid(path: string): boolean {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  }
}
