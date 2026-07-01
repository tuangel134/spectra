import { spawn } from "node:child_process"

import type { Tool, ToolContext, ToolResult } from "./types.js"
import { objectSchema } from "./types.js"
import { truncate } from "./fs-helpers.js"
import { shellFor, detachForGroupKill, killTree } from "../util/platform.js"

const MAX_OUTPUT = 50_000
const DEFAULT_TIMEOUT = 120_000

export const bashTool: Tool = {
  name: "bash",
  description:
    "Execute a shell command in the project directory. Returns combined stdout and stderr.",
  category: "shell",
  parameters: objectSchema(
    {
      command: { type: "string", description: "The shell command to run" },
      timeout: { type: "number", description: "Timeout in milliseconds" },
    },
    ["command"],
  ),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const command = String(args["command"] ?? "")
    if (!command) return { success: false, output: "Error: 'command' is required." }

    const timeout = args["timeout"] ? Number(args["timeout"]) : DEFAULT_TIMEOUT

    const level = ctx.permissionFor("bash", command)
    if (level === "deny") {
      return { success: false, output: `Error: command denied by permissions: ${command}` }
    }
    if (level === "ask") {
      const approved = await ctx.requestApproval("bash", command)
      if (!approved) return { success: false, output: `Command rejected by user: ${command}` }
    }

    ctx.report(`$ ${command}`)

    return new Promise<ToolResult>((resolvePromise) => {
      const { file, args: shellArgs } = shellFor(command)
      const child = spawn(file, shellArgs, {
        cwd: ctx.projectRoot,
        env: process.env,
        // Own process group (POSIX) so a timeout can kill the whole tree (the
        // shell AND any child it spawned), not just the shell — otherwise an
        // orphaned grandchild keeps the output pipe open and stalls completion.
        // On Windows the tree is killed via taskkill /t instead (see killTree).
        ...detachForGroupKill(),
        // Close stdin so an interactive prompt (sudo password, `apt` "[Y/n]",
        // etc.) fails fast on EOF instead of hanging until the timeout.
        stdio: ["ignore", "pipe", "pipe"],
      })

      let output = ""
      let killed = false

      const killTreeNow = (): void => {
        killTree(child)
      }

      const timer = setTimeout(() => {
        killed = true
        killTreeNow()
      }, timeout)

      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString()
      })
      child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString()
      })

      child.on("error", (err) => {
        clearTimeout(timer)
        resolvePromise({
          success: false,
          output: `Failed to run command: ${err.message}`,
        })
      })

      child.on("close", (code) => {
        clearTimeout(timer)
        if (killed) {
          resolvePromise({
            success: false,
            output: truncate(output, MAX_OUTPUT) + `\n[command timed out after ${timeout}ms]`,
          })
          return
        }
        const exitNote = code === 0 ? "" : `\n[exit code ${code}]`
        resolvePromise({
          success: code === 0,
          output: truncate(output, MAX_OUTPUT) + exitNote || "(no output)",
          metadata: { exitCode: code },
        })
      })
    })
  },
}
