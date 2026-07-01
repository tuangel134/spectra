import { test } from "node:test"
import assert from "node:assert/strict"

import { parseTasks, serializeTasks } from "../src/spec/parser.ts"

const SAMPLE = `# Tasks: Add auth

## Execution Plan

- [ ] Task 1: Create the user schema
  - Dependencies: []
  - Files: [src/db/user.ts]
  - Validation: npm run typecheck

- [x] Task 2: Add login endpoint
  - Dependencies: [1]
  - Files: [src/api/login.ts, src/api/index.ts]
  - Validation: npm test

- [~] Task 3: Add session middleware
  - Dependencies: [1, 2]
  - Files: [src/middleware/session.ts]
  - Validation: npm test
`

test("parseTasks extracts all tasks with metadata", () => {
  const tasks = parseTasks(SAMPLE)
  assert.equal(tasks.length, 3)

  assert.equal(tasks[0]!.id, 1)
  assert.equal(tasks[0]!.title, "Create the user schema")
  assert.equal(tasks[0]!.status, "pending")
  assert.deepEqual(tasks[0]!.dependencies, [])
  assert.deepEqual(tasks[0]!.files, ["src/db/user.ts"])

  assert.equal(tasks[1]!.status, "completed")
  assert.deepEqual(tasks[1]!.dependencies, [1])
  assert.deepEqual(tasks[1]!.files, ["src/api/login.ts", "src/api/index.ts"])

  assert.equal(tasks[2]!.status, "in_progress")
  assert.deepEqual(tasks[2]!.dependencies, [1, 2])
})

test("serializeTasks round-trips through parseTasks", () => {
  const tasks = parseTasks(SAMPLE)
  const serialized = serializeTasks("Add auth", tasks)
  const reparsed = parseTasks(serialized)
  assert.equal(reparsed.length, tasks.length)
  assert.equal(reparsed[1]!.status, "completed")
  assert.deepEqual(reparsed[2]!.dependencies, [1, 2])
})
