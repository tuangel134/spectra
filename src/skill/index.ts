/**
 * Skill registry + the `skill` tool.
 *
 * The registry caches discovered skills. The `skill` tool gives the agent
 * progressive disclosure: `action:"list"` returns the catalog (names +
 * descriptions), `action:"use"` returns a named skill's full instructions for
 * the agent to follow.
 */

import type { Tool, ToolContext, ToolResult } from "../tool/types.js"
import { objectSchema } from "../tool/types.js"
import { loadSkills } from "./loader.js"
import type { Skill } from "./types.js"

export * from "./types.js"
export { loadSkills, parseFrontmatter } from "./loader.js"

export class SkillRegistry {
  private skills: Skill[]

  constructor(private readonly projectRoot: string) {
    this.skills = loadSkills(projectRoot)
  }

  /** Re-scan the skill directories. */
  reload(): void {
    this.skills = loadSkills(this.projectRoot)
  }

  list(): Skill[] {
    return this.skills
  }

  get(name: string): Skill | undefined {
    return this.skills.find((s) => s.name === name)
  }

  /** A short catalog string for injection into a system prompt. */
  catalog(): string {
    if (this.skills.length === 0) return ""
    return this.skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")
  }
}

/** Build the `skill` tool bound to a registry. */
export function createSkillTool(registry: SkillRegistry): Tool {
  return {
    name: "skill",
    description:
      "Access reusable agent skills (curated instructions for specific tasks). " +
      'Use action="list" to see available skills, then action="use" with a skill ' +
      "name to load its full instructions and follow them.",
    category: "meta",
    availableToSubagents: true,
    parameters: objectSchema(
      {
        action: { type: "string", enum: ["list", "use"], description: 'Either "list" or "use"' },
        name: { type: "string", description: 'Skill name (required when action is "use")' },
      },
      ["action"],
    ),
    async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const action = String(args["action"] ?? "list")
      if (action === "list") {
        const skills = registry.list()
        if (skills.length === 0) {
          return { success: true, output: "No skills installed. Add one at .spectra/skills/<name>/SKILL.md" }
        }
        return {
          success: true,
          output: "Available skills:\n" + skills.map((s) => `- ${s.name}: ${s.description}`).join("\n"),
        }
      }
      if (action === "use") {
        const name = String(args["name"] ?? "").trim()
        if (!name) return { success: false, output: "Error: 'name' is required when action is 'use'." }
        const skill = registry.get(name)
        if (!skill) {
          return { success: false, output: `Error: no skill named "${name}". Use action:"list" to see options.` }
        }
        return {
          success: true,
          output: `# Skill: ${skill.name}\n${skill.description}\n\n${skill.instructions}`,
          metadata: { skill: skill.name, source: skill.source },
        }
      }
      return { success: false, output: `Error: unknown action "${action}". Use "list" or "use".` }
    },
  }
}
