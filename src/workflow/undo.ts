/**
 * Undo support: revert a snapshot's file changes.
 */

import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"

import type { Snapshot } from "../session/types.js"

/** Apply the inverse of a snapshot, restoring files to their prior state. */
export function applyUndo(projectRoot: string, snapshot: Snapshot): number {
  let reverted = 0

  // Revert in reverse order so sequential edits to the same file unwind correctly.
  for (const change of [...snapshot.changes].reverse()) {
    const absolute = resolve(projectRoot, change.path)

    if (change.before === null) {
      // File was created; delete it.
      if (existsSync(absolute)) {
        unlinkSync(absolute)
        reverted++
      }
    } else {
      // File existed; restore its prior content.
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, change.before, "utf-8")
      reverted++
    }
  }

  return reverted
}

/** Re-apply a snapshot's changes (used by /redo after an /undo). */
export function applyRedo(projectRoot: string, snapshot: Snapshot): number {
  let restored = 0
  for (const change of snapshot.changes) {
    const absolute = resolve(projectRoot, change.path)
    if (change.after === null) {
      // The change had deleted the file; delete it again.
      if (existsSync(absolute)) {
        unlinkSync(absolute)
        restored++
      }
    } else {
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, change.after, "utf-8")
      restored++
    }
  }
  return restored
}
