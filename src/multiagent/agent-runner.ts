import type { Runtime } from "../runtime.js"
import { connectIntegrations, createRuntime } from "../runtime.js"
import type { Task } from "../spec/types.js"
import type { IsolatedAgentRunner } from "./types.js"

export class SpectraIsolatedAgentRunner implements IsolatedAgentRunner {
  constructor(private readonly parent: Runtime) {}

  async run(task: Task, worktreePath: string): Promise<{ success: boolean; error?: string }> {
    const child = createRuntime({ cwd: worktreePath })
    try {
      await connectIntegrations(child)
      const agent = child.agents.current_()
      const session = child.sessions.create(agent.id, agent.model ?? child.config.config.model, undefined, false)
      await child.loop.run({
        sessionId: session.id,
        agent,
        userMessage: [
          `You are isolated in a Git worktree for task #${task.id}: ${task.title}.`,
          task.description,
          `You may modify ONLY these declared files or directories: ${task.files.join(", ") || "none"}.`,
          `Validation command: ${task.validation || "none"}.`,
          "Implement the task completely. Do not commit, merge, push, change branches, or edit files outside the declared claims. Spectra will review and integrate the patch.",
        ].join("\n\n"),
        handlers: {
          onText: () => {},
          onToolStart: () => {},
          onToolEnd: () => {},
          report: () => {},
          requestApproval: async (toolName: string, detail: string) => {
            if (["write", "edit", "apply_patch", "multiedit"].includes(toolName)) return true
            if (toolName === "bash") {
              return !/(^|\s)(sudo|doas|pkexec|runas)(\s|$)|rm\s+-rf|mkfs|shutdown|reboot|git\s+push/i.test(detail)
            }
            return this.parent.config.config.autoApprove
          },
        },
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    } finally {
      try { child.sessions.flush() } catch { /* ignore */ }
      try { child.mcp.close() } catch { /* ignore */ }
      try { child.lsp.close() } catch { /* ignore */ }
    }
  }
}
