#!/usr/bin/env node
/**
 * Minimal fake MCP server over stdio for tests.
 * Implements initialize, tools/list, tools/call (a single `echo` tool).
 */
import { createInterface } from "node:readline"

const rl = createInterface({ input: process.stdin })

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n")
}

rl.on("line", (line) => {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  if (req.method === "initialize") {
    send({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1.0" } } })
  } else if (req.method === "notifications/initialized") {
    // no response
  } else if (req.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echo back the provided text",
            inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          },
        ],
      },
    })
  } else if (req.method === "tools/call") {
    const text = req.params?.arguments?.text ?? ""
    send({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: `echo: ${text}` }] } })
  } else if (req.id !== undefined) {
    send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "method not found" } })
  }
})
