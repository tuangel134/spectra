import { test } from "node:test"
import assert from "node:assert/strict"

import { createRuntime } from "../src/runtime.ts"
import { createServer } from "../src/server/index.ts"

/**
 * Stability: the server must start, serve, reject unauthenticated requests,
 * and close cleanly without leaking handles.
 */
test("server starts, authenticates, and closes cleanly", async () => {
  const rt = createRuntime()
  const server = createServer(rt, { port: 0, hostname: "127.0.0.1", cors: [] })
  await server.listen()
  const addr = (server.raw.address() as { port: number }).port
  const base = `http://127.0.0.1:${addr}`

  // Health is exempt and returns a token.
  const health = await (await fetch(base + "/health")).json()
  assert.equal(health.status, "ok")
  assert.ok(health.token, "should issue an auth token")

  // Unauthenticated API call is rejected.
  const noAuth = await fetch(base + "/api/tools")
  assert.equal(noAuth.status, 401)

  // Authenticated call works.
  const withAuth = await fetch(base + "/api/tools", { headers: { authorization: `Bearer ${health.token}` } })
  assert.equal(withAuth.status, 200)

  // Unknown route → 404, not a crash.
  const notFound = await fetch(base + "/api/does-not-exist", { headers: { authorization: `Bearer ${health.token}` } })
  assert.equal(notFound.status, 404)

  // Malformed POST body must not crash the server.
  const badBody = await fetch(base + "/api/routing", {
    method: "POST",
    headers: { authorization: `Bearer ${health.token}`, "content-type": "application/json" },
    body: "{not valid json",
  })
  assert.ok(badBody.status < 500, "malformed body should not 500")

  await server.close()
})
