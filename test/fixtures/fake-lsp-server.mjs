#!/usr/bin/env node
/**
 * Minimal fake LSP server over stdio (Content-Length framing) for tests.
 * Responds to initialize and, on didOpen, publishes one error diagnostic.
 */
let buffer = Buffer.alloc(0)

function send(msg) {
  const body = JSON.stringify(msg)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`)
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n")
    if (headerEnd < 0) return
    const header = buffer.subarray(0, headerEnd).toString("utf-8")
    const m = header.match(/Content-Length:\s*(\d+)/i)
    if (!m) { buffer = buffer.subarray(headerEnd + 4); continue }
    const len = Number(m[1])
    const start = headerEnd + 4
    if (buffer.length < start + len) return
    const body = buffer.subarray(start, start + len).toString("utf-8")
    buffer = buffer.subarray(start + len)
    let msg
    try { msg = JSON.parse(body) } catch { continue }
    handle(msg)
  }
})

function handle(msg) {
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } })
  } else if (msg.method === "textDocument/didOpen") {
    const uri = msg.params.textDocument.uri
    send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri,
        diagnostics: [
          {
            severity: 1,
            range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
            message: "Type 'string' is not assignable to type 'number'.",
            source: "ts",
            code: 2322,
          },
        ],
      },
    })
  }
}
