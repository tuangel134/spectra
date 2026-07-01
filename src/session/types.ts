import type { ChatMessage } from "../provider/types.js"

export interface FileChange {
  path: string
  before: string | null
  after: string | null
}

export interface ToolLogEntry {
  id: string
  tool: string
  args: string
  status: "ok" | "error"
  output: string
  timestamp: number
}

export interface Snapshot {
  id: string
  messageIndex: number
  changes: FileChange[]
  timestamp: number
}

export interface Session {
  id: string
  title: string
  agentId: string
  model: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  parentId?: string
  childIds: string[]
  specId?: string
  usage: { inputTokens: number; outputTokens: number }
  /** Tool invocations recorded during the session (for the Logs tab). */
  toolLogs: ToolLogEntry[]
  /** Latest content of each file changed this session (for Files/Diff tabs). */
  changedFiles: Record<string, FileChange>
}
