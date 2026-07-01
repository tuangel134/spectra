/**
 * ACP (Agent Client Protocol) server.
 *
 * Lets ACP-compatible editors (e.g. Zed) drive Spectra over stdio using
 * newline-delimited JSON-RPC 2.0. It implements the core ACP surface:
 *   - initialize         → advertise protocol version + capabilities
 *   - session/new        → create a session, return its id
 *   - session/prompt     → run the agent, stream session/update notifications,
 *                          resolve with a stopReason
 *
 * This gives Spectra reach inside existing editors without forking them.
 */

import { createInterface } from "node:readline"

import type { Runtime } from "../runtime.js"
import type { LoopHandlers } from "../session/loop.js"

const ACP_PROTOCOL_VERSION = 1

interface JsonRpc {
  jsonrpc: "2.0"
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

export class AcpServer {
  private readonly sessions = new Map<string, string>() // acpSessionId -> spectra session id

  constructor(
    private readonly rt: Runtime,
    private readonly out: NodeJS.WritableStream = process.stdout,
    private readonly input: NodeJS.ReadableStream = process.stdin,
  ) {}

  /** Start reading JSON-RPC messages from stdin until the stream closes. */
  async start(): Promise<void> {
    const rl = createInterface({ input: this.input })
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let msg: JsonRpc
      try {
        msg = JSON.parse(trimmed) as JsonRpc
      } catch {
        continue
      }
      await this.handle(msg)
    }
  }

  private send(msg: JsonRpc): void {
    this.out.write(JSON.stringify(msg) + "\n")
  }

  private reply(id: JsonRpc["id"], result: unknown): void {
    this.send({ jsonrpc: "2.0", id, result })
  }

  private fail(id: JsonRpc["id"], code: number, message: string): void {
    this.send({ jsonrpc: "2.0", id, error: { code, message } })
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: "2.0", method, params })
  }

  private async handle(msg: JsonRpc): Promise<void> {
    const { id, method, params = {} } = msg
    switch (method) {
      case "initialize":
        this.reply(id, {
          protocolVersion: ACP_PROTOCOL_VERSION,
          agentCapabilities: { promptCapabilities: { image: true }, loadSession: true },
          agentInfo: { name: "spectra", version: "0.1.0" },
        })
        return

      case "session/new": {
        const agent = this.rt.agents.current_()
        const session = this.rt.sessions.create(agent.id, agent.model ?? this.rt.config.config.model)
        const acpId = `acp_${session.id}`
        this.sessions.set(acpId, session.id)
        this.reply(id, { sessionId: acpId })
        return
      }

      case "session/prompt": {
        const acpId = String(params["sessionId"] ?? "")
        const sessionId = this.sessions.get(acpId)
        if (!sessionId) {
          this.fail(id, -32602, `unknown sessionId "${acpId}"`)
          return
        }
        const text = this.extractPrompt(params["prompt"])
        const handlers = this.streamHandlers(acpId)
        try {
          await this.rt.loop.run({
            sessionId,
            agent: this.rt.agents.current_(),
            userMessage: text,
            handlers,
          })
          this.reply(id, { stopReason: "end_turn" })
        } catch (err) {
          this.fail(id, -32603, (err as Error).message)
        }
        return
      }

      case "session/cancel":
        this.reply(id, {})
        return

      default:
        if (id !== undefined) this.fail(id, -32601, `method not found: ${method}`)
    }
  }

  /** ACP prompt is an array of content blocks; pull out the text. */
  private extractPrompt(prompt: unknown): string {
    if (typeof prompt === "string") return prompt
    if (Array.isArray(prompt)) {
      return prompt
        .map((b) => (b && typeof b === "object" && typeof (b as { text?: string }).text === "string" ? (b as { text: string }).text : ""))
        .filter(Boolean)
        .join("\n")
    }
    return ""
  }

  /** Stream agent output back as ACP session/update notifications. */
  private streamHandlers(acpId: string): LoopHandlers {
    const update = (update: Record<string, unknown>): void =>
      this.notify("session/update", { sessionId: acpId, update })
    return {
      onText: (text) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } }),
      onToolStart: (name, args) =>
        update({ sessionUpdate: "tool_call", title: name, status: "in_progress", rawInput: args }),
      onToolEnd: (name, success, output) =>
        update({ sessionUpdate: "tool_call_update", title: name, status: success ? "completed" : "failed", content: [{ type: "content", content: { type: "text", text: output.slice(0, 2000) } }] }),
      report: (m) => update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: m } }),
      requestApproval: async () => true,
    }
  }
}

/** Run the ACP server over the process stdio. */
export async function runAcpServer(rt: Runtime): Promise<void> {
  await new AcpServer(rt).start()
}
