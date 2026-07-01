/**
 * Integration test: Autochange failover.
 *
 * Validates that when the primary model throws a quota exhaustion error, the
 * loop transparently falls back to the next model in the chain and completes
 * the request — end-to-end through the real AgentLoop, not just unit logic.
 */
import { test } from "node:test"
import assert from "node:assert/strict"

import { AgentLoop, type LoopDeps, type LoopHandlers } from "../src/session/loop.ts"
import { SessionManager } from "../src/session/manager.ts"
import { ToolRegistry } from "../src/tool/registry.ts"
import { ModelRouter, type RoutingConfig } from "../src/routing/index.ts"
import { ProviderError } from "../src/provider/types.ts"
import type { Provider, CompletionRequest, CompletionResult, ResolvedModel } from "../src/provider/types.ts"
import type { Agent } from "../src/agent/types.ts"

/** A mock provider that fails on the first model and succeeds on the second. */
class MockProvider implements Provider {
  readonly family = "openai-compatible" as const
  calls: string[] = []
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const model = req.model.modelId
    this.calls.push(model)
    if (model === "expensive-model") {
      throw new ProviderError("You exceeded your current quota", 429, "insufficient_quota")
    }
    return {
      content: `Hello from ${model}`,
      toolCalls: [],
      stopReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5 },
    }
  }
}

function fakeResolve(modelString: string): ResolvedModel {
  const [pid, mid] = modelString.split("/")
  return {
    providerId: pid!,
    modelId: mid!,
    baseURL: "http://fake",
    apiKey: "k",
    sdk: "openai-compatible",
    headers: {},
    timeout: 5000,
    info: {
      id: mid!,
      name: mid!,
      providerId: pid!,
      contextWindow: 128_000,
      supportsTools: true,
      supportsImages: false,
    },
  }
}

test("AgentLoop fails over to the next model when primary is exhausted", async () => {
  const mock = new MockProvider()
  const sessions = new SessionManager()
  const tools = new ToolRegistry([]) // no tools for this test

  const routingCfg: RoutingConfig = {
    mode: "manual",
    assignments: {},
    autochange: { enabled: true, fallbacks: ["fallback/cheap-model"] },
  }
  const router = new ModelRouter(
    () => routingCfg,
    () => "primary/expensive-model",
    () => "primary/expensive-model",
  )

  const deps: LoopDeps = {
    providers: {
      resolve: fakeResolve,
      client: () => mock,
    } as unknown as LoopDeps["providers"],
    tools,
    sessions,
    globalPermissions: {},
    projectRoot: "/tmp",
    router,
  }
  const loop = new AgentLoop(deps)
  const agent: Agent = {
    id: "build",
    description: "x",
    mode: "primary",
    prompt: "you are a test agent",
    permission: {},
    hidden: false,
    disabled: false,
    allowedTools: null,
  }
  const session = sessions.create("build", "primary/expensive-model")
  const reports: string[] = []
  const handlers: LoopHandlers = {
    onText: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    report: (m) => reports.push(m),
    requestApproval: async () => true,
  }

  const result = await loop.run({ sessionId: session.id, agent, userMessage: "hi", handlers })

  // Verify: the primary was called and failed, then the fallback succeeded.
  assert.equal(mock.calls[0], "expensive-model", "primary should be tried first")
  assert.equal(mock.calls[1], "cheap-model", "fallback should be tried second")
  assert.match(result.finalText, /cheap-model/, "final answer should come from fallback")
  assert.ok(reports.some((r) => /switching/i.test(r)), "should report the switch to the user")
})
