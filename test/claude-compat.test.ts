import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadSkills } from "../src/skill/loader.js"
import { loadCustomCommands, expandCommandTemplate } from "../src/commands/custom.js"
import { discoverClaudePluginRoots, loadClaudeAgents, loadClaudeMcp } from "../src/compat/claude.js"

test("loads Claude project skills, commands, agents and MCP", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-claude-"))
  const home = join(root, "home")
  try {
    mkdirSync(home, { recursive: true })
    mkdirSync(join(root, ".claude", "skills", "review"), { recursive: true })
    writeFileSync(join(root, ".claude", "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review code\nallowed-tools:\n  - Read\n  - Grep\n---\nReview carefully.")
    mkdirSync(join(root, ".claude", "commands"), { recursive: true })
    writeFileSync(join(root, ".claude", "commands", "ship.md"), "---\ndescription: Ship it\n---\nDeploy $ARGUMENTS")
    mkdirSync(join(root, ".claude", "agents"), { recursive: true })
    writeFileSync(join(root, ".claude", "agents", "auditor.md"), "---\nname: auditor\ndescription: Security auditor\ntools: Read, Grep\n---\nAudit the repository.")
    writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { docs: { command: "node", args: ["server.js"] } } }))

    assert.equal(loadSkills(root, home).find((s) => s.name === "review")?.source, "claude-project")
    assert.equal(loadCustomCommands(root, home).find((c) => c.name === "ship")?.source, "claude-project")
    assert.equal(expandCommandTemplate("Deploy $1 / $ARGUMENTS", "prod now"), "Deploy prod / prod now")
    assert.deepEqual(loadClaudeAgents(root, home).auditor?.tools, ["read", "grep"])
    assert.equal(loadClaudeMcp(root, home).docs?.command, "node")
    assert.equal(loadClaudeMcp(root, home).docs?.disabled, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("loads enabled Claude marketplace plugin components with namespaces", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-plugin-project-"))
  const home = mkdtempSync(join(tmpdir(), "spectra-plugin-home-"))
  const plugin = join(home, ".claude", "plugins", "cache", "official", "superpowers", "1.2.3")
  try {
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true })
    mkdirSync(join(home, ".claude"), { recursive: true })
    mkdirSync(join(plugin, "skills", "review"), { recursive: true })
    mkdirSync(join(plugin, "special"), { recursive: true })
    mkdirSync(join(plugin, ".claude-plugin"), { recursive: true })

    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "superpowers@official": true } }))
    writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
      version: 2,
      plugins: {
        "superpowers@official": [{
          scope: "user",
          installPath: plugin,
          version: "1.2.3",
          lastUpdated: "2026-07-10T00:00:00Z",
        }],
      },
    }))
    writeFileSync(join(plugin, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Plugin review\n---\nReview from plugin.")
    writeFileSync(join(plugin, "special", "ship.md"), "Ship $ARGUMENTS")
    writeFileSync(join(plugin, "special", "auditor.md"), "---\ndescription: Plugin auditor\ntools: Read\nmaxTurns: 12\n---\nAudit from plugin.")
    writeFileSync(join(plugin, "mcp-extra.json"), JSON.stringify({ mcpServers: { tools: { command: "${CLAUDE_PLUGIN_ROOT}/server", args: ["--root", "${CLAUDE_PROJECT_DIR}"] } } }))
    writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "superpowers",
      commands: "./special/ship.md",
      agents: "./special/auditor.md",
      mcpServers: "./mcp-extra.json",
    }))

    assert.equal(discoverClaudePluginRoots(root, home)[0]?.path, plugin)
    assert.equal(loadSkills(root, home).find((s) => s.name === "superpowers:review")?.source, "claude-plugin:superpowers@official")
    assert.equal(loadCustomCommands(root, home).find((c) => c.name === "superpowers:ship")?.template, "Ship $ARGUMENTS")
    const agent = loadClaudeAgents(root, home)["superpowers:auditor"]
    assert.equal(agent?.prompt, "Audit from plugin.")
    assert.equal(agent?.steps, 12)
    const mcp = loadClaudeMcp(root, home)["superpowers:tools"]
    assert.equal(mcp?.command, `${plugin}/server`)
    assert.deepEqual(mcp?.args, ["--root", root])
    assert.equal(mcp?.disabled, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})


test("preserves the historical Spectra skill source identifier", () => {
  const root = mkdtempSync(join(tmpdir(), "spectra-native-skill-"))
  const home = mkdtempSync(join(tmpdir(), "spectra-native-home-"))
  try {
    const dir = join(root, ".spectra", "skills", "native")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "SKILL.md"), "---\nname: native\ndescription: Native Spectra skill\n---\nUse Spectra.\n")
    assert.equal(loadSkills(root, home).find((skill) => skill.name === "native")?.source, "spectra")
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})
