/**
 * Agent Skills — shared types.
 *
 * A skill is a folder with a `SKILL.md` file: YAML frontmatter (name +
 * description) plus markdown instructions. This mirrors Claude Code / Kiro
 * "skills": the agent sees only the name and description (progressive
 * disclosure) and pulls the full instructions on demand via the `skill` tool.
 */

export interface Skill {
  /** Unique skill name (from frontmatter or folder name). */
  name: string
  /** One-line description shown in the skill catalog. */
  description: string
  /** Full markdown instructions, loaded on demand. */
  instructions: string
  /** Absolute path to the SKILL.md file. */
  path: string
  /** Where it came from (spectra / claude / opencode). */
  source: string
  /** Optional allowed-tools hint from frontmatter. */
  allowedTools?: string[]
}
