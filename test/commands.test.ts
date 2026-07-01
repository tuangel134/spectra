import { test } from "node:test"
import assert from "node:assert/strict"

import { COMMANDS, filterCommands } from "../src/commands.ts"

test("command catalog includes the core commands", () => {
  const names = COMMANDS.map((c) => c.command)
  for (const expected of ["/connect", "/model", "/models", "/spec", "/run", "/undo", "/help"]) {
    assert.ok(names.includes(expected), `missing ${expected}`)
  }
})

test("filterCommands narrows by prefix as you type", () => {
  assert.deepEqual(
    filterCommands("/mod").map((c) => c.command),
    ["/model", "/models", "/mode"],
  )
  assert.deepEqual(filterCommands("/con").map((c) => c.command), ["/connect"])
})

test("filterCommands returns all on bare slash", () => {
  const all = filterCommands("/")
  assert.ok(all.length >= 10)
})

test("filterCommands stops once a space is typed (handled by caller) but matches first word", () => {
  // After a full command, the first word still matches that command (and any
  // command sharing the prefix, e.g. /spec also surfaces /specmode).
  assert.deepEqual(filterCommands("/spec").map((c) => c.command), ["/spec", "/specmode"])
  assert.deepEqual(filterCommands("/specm").map((c) => c.command), ["/specmode"])
})

test("filterCommands returns nothing for non-slash input", () => {
  assert.deepEqual(filterCommands("hello"), [])
})
