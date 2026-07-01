import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseFrontmatter, loadSkills } from "../src/skill/loader.ts"
import { SkillRegistry, createSkillTool } from "../src/skill/index.ts"
import type { ToolContext } from "../src/tool/types.ts"

function ctx(): ToolContext {
  return {
    projectRoot: "/tmp",
    agentId: "t",
    requestApproval: async () => true,
    permissionFor: () => "allow",
    report: () => {},
  }
}

function withSkill(fn: (root: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "spectra-skill-"))
    try {
      const skillDir = join(dir, ".spectra", "skills", "pdf-magic")
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(
        join(skillDir, "SKILL.md"),
        "---\nname: pdf-magic\ndescription: Extract tables from PDFs\n---\n\n# Steps\n1. Open the PDF\n2. Extract tables\n",
      )
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test("parseFrontmatter splits YAML frontmatter from body", () => {
  const { data, body } = parseFrontmatter("---\nname: x\ndescription: hi there\n---\nbody text")
  assert.equal(data["name"], "x")
  assert.equal(data["description"], "hi there")
  assert.equal(body, "body text")
})

test("parseFrontmatter returns the whole text when no frontmatter", () => {
  const { data, body } = parseFrontmatter("just content")
  assert.deepEqual(data, {})
  assert.equal(body, "just content")
})

test("loadSkills discovers a SKILL.md with name + description", withSkill((root) => {
  const skills = loadSkills(root)
  assert.equal(skills.length, 1)
  assert.equal(skills[0]!.name, "pdf-magic")
  assert.equal(skills[0]!.description, "Extract tables from PDFs")
  assert.equal(skills[0]!.source, "spectra")
  assert.match(skills[0]!.instructions, /Extract tables/)
}))

test("skill tool lists and uses skills", withSkill(async (root) => {
  const registry = new SkillRegistry(root)
  const tool = createSkillTool(registry)

  const list = await tool.execute({ action: "list" }, ctx())
  assert.match(list.output, /pdf-magic/)

  const use = await tool.execute({ action: "use", name: "pdf-magic" }, ctx())
  assert.equal(use.success, true)
  assert.match(use.output, /# Skill: pdf-magic/)
  assert.match(use.output, /Open the PDF/)

  const missing = await tool.execute({ action: "use", name: "nope" }, ctx())
  assert.equal(missing.success, false)
}))
