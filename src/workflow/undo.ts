/**
 * Undo support: revert a snapshot's file changes.
 */

import { writeFileSync, unlinkSync, mkdirSync, existsSync, renameSync } from "node:fs"
import { dirname, resolve, relative, isAbsolute, join } from "node:path"

import type { Snapshot } from "../session/types.js"

/**
 * Resolve a change path against the project root and REJECT anything that
 * escapes it. `change.path` is normally relative, but a crafted/absolute path
 * would otherwise let `resolve()` write or delete outside the project.
 * Returns null when the path is unsafe.
 */
function safeResolve(projectRoot: string, changePath: string): string | null {
  const root = resolve(projectRoot)
  const absolute = resolve(root, changePath)
  const rel = relative(root, absolute)
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null
  return absolute
}

/** Write a file atomically (temp in the same dir + rename) so a crash mid-write
 *  can never leave a half-written, corrupt file behind. */
function atomicWrite(absolute: string, content: string): void {
  const dir = dirname(absolute)
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.spectra-undo-${process.pid}-${Date.now()}.tmp`)
  try {
    writeFileSync(tmp, content, "utf-8")
    renameSync(tmp, absolute)
  } catch (err) {
    if (existsSync(tmp)) {
      try { unlinkSync(tmp) } catch { /* best-effort cleanup */ }
    }
    throw err
  }
}

/** Apply the inverse of a snapshot, restoring files to their prior state. */
export function applyUndo(projectRoot: string, snapshot: Snapshot): number {
  let reverted = 0

  // Revert in reverse order so sequential edits to the same file unwind correctly.
  for (const change of [...snapshot.changes].reverse()) {
    const absolute = safeResolve(projectRoot, change.path)
    if (!absolute) continue // skip paths that escape the project root

    try {
      if (change.before === null) {
        // File was created; delete it.
        if (existsSync(absolute)) {
          unlinkSync(absolute)
          reverted++
        }
      } else {
        // File existed; restore its prior content.
        atomicWrite(absolute, change.before)
        reverted++
      }
    } catch {
      // Best-effort: one file failing must not abort the whole revert and
      // leave the snapshot half-unwound.
    }
  }

  return reverted
}

/** Re-apply a snapshot's changes (used by /redo after an /undo). */
export function applyRedo(projectRoot: string, snapshot: Snapshot): number {
  let restored = 0
  for (const change of snapshot.changes) {
    const absolute = safeResolve(projectRoot, change.path)
    if (!absolute) continue

    try {
      if (change.after === null) {
        // The change had deleted the file; delete it again.
        if (existsSync(absolute)) {
          unlinkSync(absolute)
          restored++
        }
      } else {
        atomicWrite(absolute, change.after)
        restored++
      }
    } catch {
      /* best-effort per-file */
    }
  }
  return restored
}
