/**
 * Prompt builders for spec generation.
 * These are sent to the spec agent to produce each document.
 */

import type { SpecType } from "./types.js"

export function requirementsPrompt(type: SpecType, description: string, clarifications = ""): string {
  const clarifyBlock = clarifications
    ? `\n\nThe user has clarified the following decisions — honor them throughout:\n${clarifications}\n`
    : ""

  if (type === "bugfix") {
    return `Analyze this bug and write a complete bug analysis document in markdown.

Bug: "${description}"${clarifyBlock}

Include these sections:
## Bug Description
## Current Behavior
## Expected Behavior
## Steps to Reproduce
## Unchanged Behavior (what must NOT change)
## Root Cause Hypothesis

Write the document content directly. Do not include commentary.`
  }

  return `Write a complete requirements document in markdown for this feature.

Feature: "${description}"${clarifyBlock}

Include these sections:
## Summary
## User Stories (As a / I want / So that)
## Acceptance Criteria — write each in EARS notation (Easy Approach to Requirements Syntax):
   - Ubiquitous: "The <system> shall <response>."
   - Event-driven: "When <trigger>, the <system> shall <response>."
   - State-driven: "While <state>, the <system> shall <response>."
   - Conditional: "If <condition>, then the <system> shall <response>."
   - Optional: "Where <feature is included>, the <system> shall <response>."
## Non-Functional Requirements (performance, security, accessibility)
## Out of Scope

Every acceptance criterion must use "shall" and be concrete and testable. Avoid
vague words (fast, easy, user-friendly). Write the document content directly.`
}

export function designPrompt(requirements: string): string {
  return `Based on these requirements, write a technical design document in markdown.

REQUIREMENTS:
${requirements}

Include these sections:
## Architecture Overview
## Components (files/modules to create or modify)
## Sequence Diagram (use a mermaid code block)
## Data Model (if applicable)
## Error Handling
## Testing Strategy (unit, integration, e2e)
## Security Considerations

Write the document content directly.`
}

export function tasksPrompt(requirements: string, design: string): string {
  return `Based on these requirements and design, write a task list in markdown.

REQUIREMENTS:
${requirements}

DESIGN:
${design}

Output EXACTLY this format for each task (this is machine-parsed):

- [ ] Task 1: <clear, atomic title>
  - Dependencies: []
  - Files: [path/to/file.ts]
  - Validation: <how to verify completion>

- [ ] Task 2: <title>
  - Dependencies: [1]
  - Files: [path/to/other.ts]
  - Validation: npm test

Rules:
- Number tasks sequentially starting at 1.
- Each task is 15-30 minutes of work.
- Use the Dependencies field to express ordering. Tasks with [] run first.
- Include a testing task for each implementation task.
- Start the document with "# Tasks: <title>".`
}
