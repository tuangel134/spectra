/**
 * Tasks markdown parser.
 *
 * Parses a tasks.md document into structured Task objects. Expected format:
 *
 *   - [ ] Task 1: Set up the database schema
 *     - Dependencies: []
 *     - Files: [src/db/schema.ts]
 *     - Validation: npm run typecheck passes
 *
 *   - [x] Task 2: Implement the API route
 *     - Dependencies: [1]
 *     - Files: [src/api/route.ts]
 *     - Validation: npm test
 */

import type { Task, TaskStatus } from "./types.js"

function parseNumberList(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n))
}

function parseStringList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export function parseTasks(markdown: string): Task[] {
  const tasks: Task[] = []
  const lines = markdown.split("\n")
  let current: Task | null = null

  for (const line of lines) {
    const taskMatch = line.match(/^[-*]\s+\[([ xX~])\]\s+Task\s+(\d+):\s*(.+)$/)
    if (taskMatch) {
      if (current) tasks.push(current)
      const checked = taskMatch[1]!
      const status: TaskStatus =
        checked === "x" || checked === "X"
          ? "completed"
          : checked === "~"
            ? "in_progress"
            : "pending"
      current = {
        id: parseInt(taskMatch[2]!, 10),
        title: taskMatch[3]!.trim(),
        description: "",
        status,
        dependencies: [],
        files: [],
        validation: "",
      }
      continue
    }

    if (!current) continue

    const depMatch = line.match(/^\s+[-*]\s+Dependencies:\s*\[(.*)\]/i)
    if (depMatch) {
      current.dependencies = parseNumberList(depMatch[1]!)
      continue
    }

    const filesMatch = line.match(/^\s+[-*]\s+Files:\s*\[(.*)\]/i)
    if (filesMatch) {
      current.files = parseStringList(filesMatch[1]!)
      continue
    }

    const valMatch = line.match(/^\s+[-*]\s+Validation:\s*(.+)/i)
    if (valMatch) {
      current.validation = valMatch[1]!.trim()
      continue
    }

    // Any other indented, non-meta line extends the description.
    const trimmed = line.trim()
    if (trimmed && line.startsWith("  ") && !/^\s+[-*]\s+(Dependencies|Files|Validation):/i.test(line)) {
      current.description += (current.description ? "\n" : "") + trimmed
    }
  }

  if (current) tasks.push(current)
  return tasks
}

/** Serialize tasks back to markdown, preserving status. */
export function serializeTasks(title: string, tasks: Task[]): string {
  const lines: string[] = [`# Tasks: ${title}`, "", "## Execution Plan", ""]

  for (const task of tasks) {
    const box =
      task.status === "completed" ? "x" : task.status === "in_progress" ? "~" : " "
    lines.push(`- [${box}] Task ${task.id}: ${task.title}`)
    // Preserve the description: emit each line indented so a round-trip through
    // parseTasks() restores it verbatim (must not collide with meta lines).
    if (task.description) {
      for (const dline of task.description.split("\n")) {
        lines.push(`  ${dline}`)
      }
    }
    lines.push(`  - Dependencies: [${task.dependencies.join(", ")}]`)
    lines.push(`  - Files: [${task.files.join(", ")}]`)
    lines.push(`  - Validation: ${task.validation}`)
    lines.push("")
  }

  return lines.join("\n")
}
