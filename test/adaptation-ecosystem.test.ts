import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { scanEcosystem } from "../src/adaptation/ecosystem.js"

test("ecosystem inventory unifies Spectra and Claude assets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spectra-eco-"))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "spectra-home-"))
  fs.mkdirSync(path.join(root, ".spectra", "skills", "review"), { recursive: true })
  fs.mkdirSync(path.join(root, ".claude", "skills", "ship"), { recursive: true })
  fs.mkdirSync(path.join(root, ".spectra", "agents"), { recursive: true })
  fs.writeFileSync(path.join(root, ".spectra", "agents", "audit.md"), "agent")
  fs.writeFileSync(path.join(root, ".mcp.json"), "{}")
  fs.mkdirSync(path.join(home, ".claude", "skills", "global"), { recursive: true })
  const inventory = scanEcosystem(root, home)
  assert.equal(inventory.counts.skill, 3)
  assert.equal(inventory.counts.agent, 1)
  assert.equal(inventory.counts.mcp, 1)
})
