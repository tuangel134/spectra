import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { once } from "node:events"
import { normalizeOpenAIBaseURL, probeOpenAICompatible } from "../src/adaptation/model-probe.js"
import { detectLocalRuntimes } from "../src/adaptation/local-models.js"

test("normalizes copied OpenAI-compatible URLs", () => {
  assert.equal(normalizeOpenAIBaseURL("http://127.0.0.1:9999/v1/chat/completions"), "http://127.0.0.1:9999/v1")
  assert.throws(() => normalizeOpenAIBaseURL("file:///etc/passwd"))
})

test("probes discovery and deep compatibility", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json")
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "test-model" }] }))
    if (req.url === "/v1/chat/completions") return res.end(JSON.stringify({ choices: [{ message: { content: "{}", tool_calls: [] } }] }))
    res.statusCode = 404; res.end("{}")
  })
  server.listen(0, "127.0.0.1"); await once(server, "listening")
  const address = server.address(); assert(address && typeof address === "object")
  try {
    const result = await probeOpenAICompatible({ baseURL: `http://127.0.0.1:${address.port}/v1`, model: "test-model", deep: true })
    assert.equal(result.ok, true)
    assert.deepEqual(result.models, ["test-model"])
    assert.equal(result.capabilities.discovery, true)
    assert(result.compatibilityScore >= 80)
  } finally { server.close() }
})

test("local runtime detection supports custom candidates", async () => {
  const server = http.createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ id: "local-one" }] })) })
  server.listen(0, "127.0.0.1"); await once(server, "listening")
  const address = server.address(); assert(address && typeof address === "object")
  try {
    const results = await detectLocalRuntimes([{ id: "lm-studio", name: "Test runtime", baseURL: "http://127.0.0.1", modelsURL: `http://127.0.0.1:${address.port}/models` }], 1000)
    assert.equal(results[0]?.online, true)
    assert.deepEqual(results[0]?.models, ["local-one"])
  } finally { server.close() }
})
