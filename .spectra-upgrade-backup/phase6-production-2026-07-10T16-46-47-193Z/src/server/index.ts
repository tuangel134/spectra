/**
 * HTTP API server + web UI.
 *
 * Exposes Spectra over HTTP so the graphical web interface (and external
 * clients) can drive the same engine the TUI uses. Built on Node's native http
 * module — no external dependencies.
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomBytes, timingSafeEqual } from "node:crypto"
import * as nodeFs from "node:fs"
import * as nodePath from "node:path"

import type { Runtime } from "../runtime.js"
import { IdeService } from "../ide/service.js"
import type { CoreStateStore } from "../core/state-store.js"
import { CORE_PROTOCOL_VERSION } from "../core/protocol.js"
import { staticCatalog } from "../provider/catalog.js"
import { fetchLiveModelsDetailed, normalizeOpenAIBaseURL } from "../provider/model-catalog.js"
import { COMMANDS } from "../commands.js"
import { saveProviderKey, saveModel, savePermission, removeProvider, saveCustomProvider, saveCompaction, saveHeadroom, saveRouting, saveSpecDetect, saveAutorun, saveAutoApprove, saveSecurityProfile } from "../config/writer.js"
import { WEB_HTML } from "../web/html.js";
import { DESKTOP_HTML } from "../web/desktop.js"
import type { LoopHandlers } from "../session/loop.js"
import { summarizeCost } from "../util/cost.js"
import { ProjectManager } from "../projects/index.js"
import { pushToGitHub, getUsername, generateReadmePrompt } from "../github/index.js"
import { detectSpecIntent } from "../spec/detect.js"
import type { Clarification } from "../spec/clarify.js"
import { runSpecWorkflow, generateClarifyingQuestions, autoAnswerQuestions } from "../workflow/spec-workflow.js"
import { reloadRuntime, connectIntegrations } from "../runtime.js";
import { adaptationFor } from "../adaptation/index.js"
import { SpectraIsolatedAgentRunner } from "../multiagent/agent-runner.js"
import { applySecurityProfile, isSecurityProfile, listSecurityProfiles } from "../security/profiles.js"
import {
  detectVerifyCommands,
  runVerification,
  scanStructuralIssues,
  scanForSkeletons,
  collectSourceFiles,
  type CommandResult,
} from "../autorun/verify.js"

const silentLoopHandlers: LoopHandlers = {
  onText: () => {},
  onToolStart: () => {},
  onToolEnd: () => {},
  report: () => {},
  requestApproval: async () => true,
}

export interface ServerOptions {
  port: number
  hostname: string
  cors: string[]
  /** Disable auth token requirement (for tests / trusted environments). */
  noAuth?: boolean
  /** Metadata and durable journal when hosted by the persistent Core daemon. */
  core?: {
    protocolVersion: number
    instanceId: string
    startedAt: number
    state: CoreStateStore
    onProjectChanged?: (projectRoot: string) => void
  }
}

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => void | Promise<void>

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  handler: Handler
}

function compile(method: string, path: string, handler: Handler): Route {
  const keys: string[] = []
  const pattern = new RegExp(
    "^" +
      path.replace(/:([^/]+)/g, (_m, key) => {
        keys.push(key)
        return "([^/]+)"
      }) +
      "/?$",
  )
  return { method, pattern, keys, handler }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

/** Max accepted request body size (1 MiB). Prevents an unbounded body from
 *  exhausting memory (OOM DoS) since we buffer the whole payload. */
const MAX_BODY_BYTES = 1024 * 1024

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    total += buf.length
    if (total > MAX_BODY_BYTES) {
      req.destroy()
      throw new Error("request body too large")
    }
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function createServer(rt: Runtime, options: ServerOptions) {
  // Auth: generate a per-launch token. Clients must send it in the
  // `Authorization: Bearer <token>` header or `?token=<token>` query param on
  // every API call. The web UI injects the token into its JS at page load.
  // Endpoints exempt from auth: / (web page), /desktop (native shell), /health.
  const authToken = options.noAuth ? "" : randomBytes(16).toString("hex")

  // The /health endpoint is unauthenticated (used for readiness probes), so it
  // only echoes the auth token when bound to a loopback address, where any
  // local client is already trusted. On a non-loopback bind (0.0.0.0 / LAN)
  // withholding it prevents a network client from lifting the token.
  const isLoopback = ["127.0.0.1", "::1", "localhost", ""].includes(options.hostname)
  const loopbackToken = isLoopback && authToken ? authToken : undefined

  // Pending supervised-mode approvals, keyed by id. The /api/chat SSE stream
  // emits an "approval" event; the client answers via POST /api/approval.
  const approvals = new Map<string, (ok: boolean) => void>()

  function checkAuth(req: IncomingMessage, url: URL): boolean {
    if (options.noAuth || !authToken) return true
    // Constant-time compare to avoid leaking the token via response timing.
    const expected = Buffer.from(authToken)
    const timingSafe = (candidate: string | null): boolean => {
      if (!candidate) return false
      const got = Buffer.from(candidate)
      return got.length === expected.length && timingSafeEqual(got, expected)
    }
    const hdr = req.headers.authorization
    if (hdr?.startsWith("Bearer ") && timingSafe(hdr.slice(7))) return true
    if (timingSafe(url.searchParams.get("token"))) return true
    return false
  }

  const ensureSession = (): string => {
    const current = rt.sessions.current()
    if (current) return current.id
    const agent = rt.agents.current_()
    return rt.sessions.create(agent.id, agent.model ?? rt.config.config.model).id
  }

  const routes: Route[] = [
    // ----- Web UI -----
    compile("GET", "/", (_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      // Inject the auth token so the embedded JS can pass it in fetch headers —
      // but ONLY on a loopback bind, where any local client is already trusted.
      // On a non-loopback bind (0.0.0.0 / LAN) baking the token into the page
      // would hand a valid credential to any anonymous network client that GETs
      // `/`, defeating auth entirely. There the operator must supply the token
      // explicitly via `?token=<token>` (shown in the server startup log).
      const injected = isLoopback ? authToken : ""
      const html = WEB_HTML.replace(
        "const jget=",
        `const __TOKEN=${JSON.stringify(injected)}||new URLSearchParams(location.search).get("token")||"";\nconst jget=`,
      )
      res.end(html) }), compile("GET", "/desktop", (_req, res) => {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'self'; frame-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      })
      const injected = isLoopback ? authToken : ""
      res.end(DESKTOP_HTML.replace("__SPECTRA_AUTH_TOKEN__", JSON.stringify(injected)))
    }), compile("GET", "/health", (_req, res) => json(res, 200, {
      status: "ok",
      version: "0.1.0",
      protocolVersion: options.core?.protocolVersion ?? CORE_PROTOCOL_VERSION,
      instanceId: options.core?.instanceId,
      pid: process.pid,
      projectRoot: rt.config.projectRoot,
      stateBackend: options.core?.state.backend,
      startedAt: options.core?.startedAt,
      token: loopbackToken,
      autorun: { running: rt.autorun.running, hasResumable: rt.autorun.hasResumable() },
    })),
    compile("GET", "/api/core/status", (_req, res) => {
      const resumable = rt.autorun.hasResumable()
      json(res, 200, {
        managed: Boolean(options.core),
        protocolVersion: options.core?.protocolVersion ?? CORE_PROTOCOL_VERSION,
        instanceId: options.core?.instanceId ?? null,
        pid: process.pid,
        startedAt: options.core?.startedAt ?? null,
        projectRoot: rt.config.projectRoot,
        stateBackend: options.core?.state.backend ?? "session-json",
        autorun: { running: rt.autorun.running, hasResumable: resumable },
        recovery: options.core?.state.recoverySummary(resumable) ?? {
          interrupted: resumable,
          activeClients: 0,
          resumableAutorun: resumable,
        },
      })
    }),
    compile("GET", "/api/core/events", (req, res) => {
      if (!options.core) return json(res, 200, { events: [] })
      const url = new URL(req.url ?? "/", `http://${options.hostname}`)
      const limit = Number(url.searchParams.get("limit") ?? "100")
      json(res, 200, { events: options.core.state.recent(limit) })
    }),
    compile("POST", "/api/core/client/heartbeat", async (req, res) => {
      const body = await readBody(req)
      const clientId = String(body["clientId"] ?? "").trim()
      if (!clientId) return json(res, 400, { error: "clientId required" })
      options.core?.state.heartbeatClient(clientId)
      json(res, 200, { ok: true })
    }),

    // ----- Command catalog (for the slash menu) -----
    compile("GET", "/api/commands", (_req, res) => json(res, 200, COMMANDS)),

    // ----- New session -----
    compile("POST", "/api/clear", (_req, res) => {
      const agent = rt.agents.current_()
      rt.sessions.create(agent.id, agent.model ?? rt.config.config.model)
      json(res, 200, { ok: true })
    }),

    // ----- Right-panel data: specs, files, logs, permissions, memory -----
    compile("GET", "/api/specs", (_req, res) => {
      const specs = rt.specs.list().map((m) => {
        const tasks = rt.specs.loadTasks(m.id)
        return {
          id: m.id,
          title: m.title,
          type: m.type,
          createdAt: m.createdAt,
          tasks: tasks.length,
          done: tasks.filter((t) => t.status === "completed").length,
        }
      })
      json(res, 200, { specs })
    }),

    compile("GET", "/api/specs/:id", (_req, res, params) => {
      const id = params["id"]!
      const meta = rt.specs.readMeta(id)
      if (!meta) return json(res, 404, { error: "spec not found" })
      json(res, 200, {
        meta,
        tasks: rt.specs.loadTasks(id),
        requirements: rt.specs.readDocument(id, "requirements"),
        design: rt.specs.readDocument(id, "design"),
      })
    }),

    compile("GET", "/api/files", (_req, res) => {
      const session = rt.sessions.current()
      const files = session
        ? Object.values(session.changedFiles).map((c) => ({
            path: c.path,
            status: c.before === null ? "created" : c.after === null ? "deleted" : "modified",
            before: c.before,
            after: c.after,
          }))
        : []
      json(res, 200, { files })
    }),

    compile("GET", "/api/logs", (_req, res) => {
      const session = rt.sessions.current()
      json(res, 200, { logs: session?.toolLogs ?? [] })
    }),

    compile("GET", "/api/permissions", (_req, res) => {
      json(res, 200, { permissions: rt.config.config.permission })
    }),

    compile("GET", "/api/tools", (_req, res) => {
      json(res, 200, { tools: rt.tools.describe() })
    }),

    compile("GET", "/api/hooks", (_req, res) => {
      json(res, 200, {
        hooks: rt.hooks.list().map((h) => ({
          name: h.name,
          description: h.description ?? "",
          event: h.when.type,
          action: h.then.type,
        })),
      })
    }),

    compile("GET", "/api/steering", (_req, res) => {
      const root = rt.config.projectRoot
      const dir = nodePath.join(root, ".spectra", "steering")
      const files: { name: string; content: string }[] = []
      if (nodeFs.existsSync(dir)) {
        for (const f of nodeFs.readdirSync(dir)) {
          if (!f.endsWith(".md")) continue
          files.push({ name: f, content: nodeFs.readFileSync(nodePath.join(dir, f), "utf-8").slice(0, 4000) })
        }
      }
      const agentsMd = nodePath.join(root, "AGENTS.md")
      if (nodeFs.existsSync(agentsMd)) {
        files.unshift({ name: "AGENTS.md", content: nodeFs.readFileSync(agentsMd, "utf-8").slice(0, 4000) })
      }
      json(res, 200, { steering: files })
    }),

    compile("GET", "/api/mcp", (_req, res) => {
      // Real connection status from the MCP manager (connected servers + tools),
      // falling back to config-only entries that have not been connected yet.
      json(res, 200, { servers: rt.mcp.status() })
    }),

    compile("GET", "/api/skills", (_req, res) => {
      const skills = rt.skills.list().map((s) => ({
        name: s.name,
        description: s.description,
        source: s.source,
        path: s.path,
      }))
      json(res, 200, { skills })
    }),

    compile("POST", "/api/skills/reload", (_req, res) => {
      rt.skills.reload()
      rt.pushAudit("skill", `Reloaded skills (${rt.skills.list().length})`)
      json(res, 200, { ok: true, count: rt.skills.list().length })
    }),

    compile("GET", "/api/mcp/legacy", (_req, res) => {
      const root = rt.config.projectRoot
      let servers: { name: string; command?: string }[] = []
      for (const rel of [".spectra/mcp.json", ".opencode/mcp.json"]) {
        const p = nodePath.join(root, rel)
        if (nodeFs.existsSync(p)) {
          try {
            const cfg = JSON.parse(nodeFs.readFileSync(p, "utf-8")) as {
              mcpServers?: Record<string, { command?: string }>
            }
            servers = Object.entries(cfg.mcpServers ?? {}).map(([name, v]) => ({ name, command: v.command }))
          } catch {
            /* ignore */
          }
          break
        }
      }
      json(res, 200, { servers })
    }),

    compile("GET", "/api/memory", (_req, res) => {
      const root = rt.config.projectRoot
      const out: { name: string; content: string }[] = []
      for (const rel of ["AGENTS.md", ".spectra/steering/defaults.md"]) {
        const p = nodePath.join(root, rel)
        if (nodeFs.existsSync(p)) out.push({ name: rel, content: nodeFs.readFileSync(p, "utf-8").slice(0, 4000) })
      }
      json(res, 200, { memory: out })
    }),

    compile("GET", "/api/plugins", (_req, res) => { json(res, 200, { plugins: rt.plugins.list() }) }),
  compile("GET", "/api/security/status", (_req, res) => {
    const trust = rt.trust.status()
    json(res, 200, {
      profile: rt.config.config.security?.profile ?? "legacy",
      profiles: listSecurityProfiles(),
      trust,
      integrationsBlocked: !trust.trusted && trust.findings.length > 0,
      autoApprove: rt.config.config.autoApprove,
      permissions: rt.config.config.permission,
    })
  }),
  compile("POST", "/api/security/profile", async (req, res) => {
    const body = await readBody(req)
    const profile = body["profile"]
    if (!isSecurityProfile(profile)) return json(res, 400, { error: "invalid security profile" })
    if (rt.autorun.running) return json(res, 409, { error: "Pause Autopilot before changing the security profile." })
    const cwd = rt.config.projectRoot
    saveSecurityProfile(profile, cwd)
    applySecurityProfile(rt.config.config, profile)
    // Recreate integration registries so moving from Legacy to a modern profile
    // cannot leave already-loaded plugins or MCP tools active.
    reloadRuntime(rt, { cwd })
    await connectIntegrations(rt)
    rt.pushAudit("security", `Security profile → ${profile}`)
    json(res, 200, { ok: true, profile, autoApprove: rt.config.config.autoApprove, permissions: rt.config.config.permission })
  }),
  compile("POST", "/api/security/trust", async (req, res) => {
    const body = await readBody(req)
    if (rt.autorun.running) return json(res, 409, { error: "Pause Autopilot before changing Workspace Trust." })
    const action = String(body["action"] ?? "")
    const cwd = rt.config.projectRoot
    let auditAction: string
    if (action === "once") {
      rt.trust.trustOnce()
      auditAction = "Workspace trusted once"
    } else if (action === "permanent") {
      rt.trust.trustPermanently()
      auditAction = "Workspace trusted permanently"
    } else if (action === "restrict") {
      rt.trust.restrict()
      auditAction = "Workspace returned to restricted mode"
    } else {
      return json(res, 400, { error: "action must be once | permanent | restrict" })
    }
    // Rebuild registries so a trust transition cannot leave stale plugin or
    // MCP tools registered in the active runtime. Session-only trust survives
    // this reload through the process-local trust cache.
    reloadRuntime(rt, { cwd })
    await connectIntegrations(rt)
    rt.pushAudit("security", auditAction)
    json(res, 200, { ok: true, trust: rt.trust.status() })
  }),
  compile("GET", "/api/cost", (_req, res) => {
      const summary = summarizeCost(rt.sessions.list())
      json(res, 200, summary)
    }),

    compile("GET", "/api/timeline", (_req, res) => {
      const session = rt.sessions.current()
      const snaps = session ? rt.sessions.timeline(session.id) : []
      json(res, 200, {
        timeline: snaps.map((s) => ({
          id: s.id,
          messageIndex: s.messageIndex,
          timestamp: s.timestamp,
          files: s.changes.map((c) => c.path),
        })),
      })
    }),

    compile("POST", "/api/timeline/restore", async (req, res) => {
      const body = await readBody(req)
      const session = rt.sessions.current()
      if (!session) return json(res, 404, { error: "no active session" })
      const removed = rt.sessions.rewindTo(session.id, body["id"] ? String(body["id"]) : undefined)
      const { applyUndo } = await import("../workflow/undo.js")
      let reverted = 0
      for (const snap of removed) reverted += applyUndo(rt.config.projectRoot, snap)
      rt.pushAudit("timeline", `Rewound ${removed.length} snapshot(s), ${reverted} file change(s)`)
      json(res, 200, { ok: true, snapshots: removed.length, reverted })
    }),

    compile("GET", "/api/memory/entries", (_req, res) => {
      json(res, 200, { memory: rt.memory.list() })
    }),

    compile("POST", "/api/memory/forget", async (req, res) => {
      const body = await readBody(req)
      const ok = rt.memory.forget(String(body["id"] ?? ""))
      json(res, 200, { ok })
    }),

    compile("GET", "/api/audit", (_req, res) => json(res, 200, { audit: rt.audit })),

    // ----- Projects -----
    compile("GET", "/api/projects", (_req, res) => {
      const pm = new ProjectManager()
      json(res, 200, { projects: pm.list(), current: rt.config.projectRoot })
    }),

    compile("POST", "/api/projects/add", async (req, res) => {
      const body = await readBody(req)
      const path = String(body["path"] ?? "").trim()
      const name = body["name"] ? String(body["name"]) : undefined
      if (!path) return json(res, 400, { error: "path required" })
      const pm = new ProjectManager()
      const entry = pm.add(path, name)
      rt.pushAudit("project", `Registered project: ${entry.name}`, entry.path)
      json(res, 200, { ok: true, project: entry })
    }),

    compile("POST", "/api/projects/create", async (req, res) => {
      const body = await readBody(req)
      const parentDir = String(body["parentDir"] ?? rt.config.projectRoot).trim()
      const name = String(body["name"] ?? "").trim()
      if (!name) return json(res, 400, { error: "name required" })
      const pm = new ProjectManager()
      const entry = pm.create(parentDir, name)
      // Switch into the freshly created project (unless the autopilot is busy).
      if (!rt.autorun.running) {
        reloadRuntime(rt, { cwd: entry.path })
      await connectIntegrations(rt)
      options.core?.onProjectChanged?.(rt.config.projectRoot)
      }
      rt.pushAudit("project", `Created project: ${entry.name}`, entry.path)
      json(res, 200, { ok: true, project: entry, current: rt.config.projectRoot })
    }),

    // Open (switch to) an existing project: reload the engine against its root
    // and auto-resume its most recent session.
    compile("POST", "/api/projects/open", async (req, res) => {
      const body = await readBody(req)
      const path = String(body["path"] ?? "").trim()
      if (!path) return json(res, 400, { error: "path required" })
      if (!nodeFs.existsSync(path) || !nodeFs.statSync(path).isDirectory()) {
        return json(res, 400, { error: `not a directory: ${path}` })
      }
      if (rt.autorun.running) {
        return json(res, 409, { error: "Stop the Autopilot before switching projects." })
      }
      reloadRuntime(rt, { cwd: path })
  new ProjectManager().add(path)
  await connectIntegrations(rt)
  options.core?.onProjectChanged?.(rt.config.projectRoot)
      rt.pushAudit("project", "Opened project", rt.config.projectRoot)
      json(res, 200, { ok: true, current: rt.config.projectRoot })
    }),

    compile("POST", "/api/projects/remove", async (req, res) => {
      const body = await readBody(req)
      const pm = new ProjectManager()
      pm.remove(String(body["path"] ?? ""))
      json(res, 200, { ok: true })
    }),

    // ----- GitHub -----
    compile("GET", "/api/github", (_req, res) => {
      const token = rt.config.config.githubToken ?? process.env["GITHUB_TOKEN"] ?? ""
      json(res, 200, { configured: !!token })
    }),

    compile("POST", "/api/github/token", async (req, res) => {
      const body = await readBody(req)
      const token = String(body["token"] ?? "").trim()
      if (!token) return json(res, 400, { error: "token required" })
      const user = await getUsername(token)
      if (!user) return json(res, 400, { error: "Invalid token — could not authenticate with GitHub." })
      const { updateConfig, globalConfigPath } = await import("../config/writer.js")
      updateConfig(globalConfigPath(), (c) => { c.githubToken = token })
      rt.pushAudit("github", `Token set for user ${user}`)
      json(res, 200, { ok: true, username: user })
    }),

    compile("POST", "/api/freebuff/start", async (_req, res) => {
      const { startFreebuffProxy } = await import("../provider/freebuff-proxy.js")
      const result = await startFreebuffProxy()
      if (result.ok && result.baseURL) {
        rt.providers.upsertProvider("freebuff", { baseURL: result.baseURL, sdk: "openai-compatible" })
        rt.pushAudit("freebuff", "Started free-model proxy")
      }
      json(res, result.ok ? 200 : 400, result)
    }),

    compile("POST", "/api/github/push", async (req, res) => {
      const body = await readBody(req)
      const description = body["description"] ? String(body["description"]) : undefined
      const isPrivate = body["private"] === true
      const token = rt.config.config.githubToken ?? process.env["GITHUB_TOKEN"] ?? ""
      if (!token) return json(res, 400, { error: "No GitHub token. Set it in Config → GitHub." })

      // Generate README with the agent if it doesn't exist.
      const readmePath = nodePath.join(rt.config.projectRoot, "README.md")
      if (!nodeFs.existsSync(readmePath)) {
        try {
          const name = nodePath.basename(rt.config.projectRoot)
          const agent = rt.agents.current_()
          const session = rt.sessions.create(agent.id, agent.model ?? rt.config.config.model, undefined, false)
          const result = await rt.loop.run({
            sessionId: session.id,
            agent: { ...agent, allowedTools: ["write"] },
            userMessage: generateReadmePrompt(name, description ?? name),
            handlers: { onText: () => {}, onToolStart: () => {}, onToolEnd: () => {}, report: () => {}, requestApproval: async () => true },
          })
          if (result.finalText && !nodeFs.existsSync(readmePath)) {
            nodeFs.writeFileSync(readmePath, result.finalText, "utf-8")
          }
        } catch {
          /* push anyway without README */
        }
      }

      const pushResult = await pushToGitHub(rt.config.projectRoot, { token, private: isPrivate }, description)
      rt.pushAudit("github", pushResult.ok ? `Pushed to ${pushResult.repoUrl}` : `Push failed: ${pushResult.error}`)
      json(res, 200, pushResult)
    }),

    // ----- Desktop IDE workspace (Phase 3) -----
    compile("GET", "/api/ide/bootstrap", async (_req, res) => {
      json(res, 200, await new IdeService(rt).bootstrap())
    }),
    compile("POST", "/api/ide/file/read", async (req, res) => {
      const body = await readBody(req)
      const result = new IdeService(rt).readFile(String(body["path"] ?? ""))
      json(res, result.ok ? 200 : 400, result)
    }),
    compile("POST", "/api/ide/file/save", async (req, res) => {
      const body = await readBody(req)
      const result = new IdeService(rt).saveFile(
        String(body["path"] ?? ""),
        String(body["content"] ?? ""),
        body["approved"] === true,
      )
      json(res, result.ok ? 200 : result.needsApproval ? 409 : 400, result)
    }),
    compile("POST", "/api/ide/diagnostics", async (req, res) => {
      const body = await readBody(req)
      const result = await new IdeService(rt).diagnostics(String(body["path"] ?? ""))
      json(res, result.ok || result.metadata ? 200 : 400, result)
    }),
    compile("POST", "/api/ide/terminal", async (req, res) => {
      const body = await readBody(req)
      const result = await new IdeService(rt).terminal(
        String(body["command"] ?? ""),
        body["approved"] === true,
        Number(body["timeout"] ?? 120_000),
      )
      json(res, result.ok ? 200 : result.needsApproval ? 409 : 400, result)
    }),
    compile("POST", "/api/ide/git/status", async (_req, res) => {
      const result = await new IdeService(rt).gitStatus()
      json(res, result.ok ? 200 : 400, result)
    }),
    compile("POST", "/api/ide/git/diff", async (req, res) => {
      const body = await readBody(req)
      const path = typeof body["path"] === "string" && body["path"] ? String(body["path"]) : undefined
      const result = await new IdeService(rt).gitDiff(path, body["staged"] === true)
      json(res, result.ok ? 200 : 400, result)
    }),
    compile("POST", "/api/ide/spec/read", async (req, res) => {
      const body = await readBody(req)
      const result = new IdeService(rt).readSpec(String(body["id"] ?? ""))
      json(res, result.ok ? 200 : 404, result)
    }),
    compile("POST", "/api/ide/spec/save", async (req, res) => {
      const body = await readBody(req)
      const document = String(body["document"] ?? "")
      if (!["requirements", "design", "tasks"].includes(document)) {
        return json(res, 400, { ok: false, error: "invalid spec document" })
      }
      const result = new IdeService(rt).saveSpec(
        String(body["id"] ?? ""),
        document as "requirements" | "design" | "tasks",
        String(body["content"] ?? ""),
        body["approved"] === true,
      )
      json(res, result.ok ? 200 : result.needsApproval ? 409 : 400, result)
    }),

    // ----- Filesystem (for the Monaco editor) -----
    compile("POST", "/api/fs/tree", (_req, res) => {
      const root = rt.config.projectRoot
      const skip = new Set(["node_modules", "dist", "build", ".git", ".spectra", "target", "__pycache__", ".next"])
      const files: string[] = []
      const walk = (dir: string): void => {
        if (files.length >= 2000) return
        let entries: string[]
        try { entries = nodeFs.readdirSync(dir) } catch { return }
        for (const e of entries) {
          if (e.startsWith(".") && e !== ".gitignore") continue
          if (skip.has(e)) continue
          const full = nodePath.join(dir, e)
          let st: nodeFs.Stats
          try { st = nodeFs.statSync(full) } catch { continue }
          if (st.isDirectory()) walk(full)
          else if (st.size < 800_000) files.push(nodePath.relative(root, full))
          if (files.length >= 2000) return
        }
      }
      walk(root)
      json(res, 200, { files: files.sort() })
    }),

    compile("POST", "/api/fs/read", async (req, res) => {
      const body = await readBody(req)
      const rel = String(body["path"] ?? "")
      const root = rt.config.projectRoot
      const abs = nodePath.resolve(root, rel)
      if (abs !== root && !abs.startsWith(root + nodePath.sep)) return json(res, 400, { error: "path outside project" })
      if (!nodeFs.existsSync(abs) || nodeFs.statSync(abs).isDirectory()) return json(res, 404, { error: "not a file" })
      try {
        json(res, 200, { path: rel, content: nodeFs.readFileSync(abs, "utf-8") })
      } catch (err) {
        json(res, 500, { error: (err as Error).message })
      }
    }),

    compile("POST", "/api/fs/save", async (req, res) => {
      const body = await readBody(req)
      const rel = String(body["path"] ?? "")
      const content = String(body["content"] ?? "")
      const root = rt.config.projectRoot
      const abs = nodePath.resolve(root, rel)
      if (abs !== root && !abs.startsWith(root + nodePath.sep)) return json(res, 400, { error: "path outside project" })
      try {
        nodeFs.writeFileSync(abs, content, "utf-8")
        rt.pushAudit("editor", `Saved ${rel}`)
        json(res, 200, { ok: true })
      } catch (err) {
        json(res, 500, { error: (err as Error).message })
      }
    }),



    // ----- Adaptive Desktop and universal user profile -----
    compile("GET", "/api/adaptation/profile", (_req, res) => {
      const service = adaptationFor(rt.config.projectRoot)
      json(res, 200, { profile: service.profiles.load() })
    }),
    compile("POST", "/api/adaptation/profile", async (req, res) => {
      const body = await readBody(req)
      try {
        const service = adaptationFor(rt.config.projectRoot)
        const profile = service.profiles.save(body["profile"] ?? body)
        rt.pushAudit("adaptation", "Updated user adaptation profile")
        json(res, 200, { ok: true, profile, recommendations: service.dashboard()["recommendations"] })
      } catch (error) { json(res, 400, { error: (error as Error).message }) }
    }),
    compile("GET", "/api/adaptation/profile/export", (_req, res) => {
      json(res, 200, adaptationFor(rt.config.projectRoot).profiles.export())
    }),
    compile("POST", "/api/adaptation/profile/import", async (req, res) => {
      const body = await readBody(req)
      try {
        const profile = adaptationFor(rt.config.projectRoot).profiles.import(body["profile"] ?? body)
        rt.pushAudit("adaptation", "Imported user adaptation profile")
        json(res, 200, { ok: true, profile })
      } catch (error) { json(res, 400, { error: (error as Error).message }) }
    }),
    compile("GET", "/api/adaptation/dashboard", (_req, res) => {
      json(res, 200, adaptationFor(rt.config.projectRoot).dashboard())
    }),
    compile("GET", "/api/adaptation/ecosystem", (_req, res) => {
      const dashboard = adaptationFor(rt.config.projectRoot).dashboard()
      json(res, 200, { ecosystem: dashboard["ecosystem"] })
    }),
    compile("GET", "/api/adaptation/models/local", async (_req, res) => {
      json(res, 200, { runtimes: await adaptationFor(rt.config.projectRoot).localModels() })
    }),
    compile("POST", "/api/adaptation/models/probe", async (req, res) => {
      const body = await readBody(req)
      const baseURL = String(body["baseURL"] ?? "").trim()
      if (!baseURL) return json(res, 400, { error: "baseURL required" })
      try {
        const result = await adaptationFor(rt.config.projectRoot).probe({
          baseURL,
          apiKey: typeof body["apiKey"] === "string" ? body["apiKey"] : undefined,
          model: typeof body["model"] === "string" ? body["model"] : undefined,
          deep: body["deep"] === true,
        })
        json(res, 200, result)
      } catch (error) { json(res, 400, { error: (error as Error).message }) }
    }),
    // ----- Isolated multi-agent execution -----
    compile("GET", "/api/multiagent", (_req, res) => {
      json(res, 200, { runs: rt.multiagent.list(), locks: rt.multiagent.locks.list() })
    }),
    compile("POST", "/api/multiagent/plan", async (req, res) => {
      const body = await readBody(req)
      const specId = String(body["specId"] ?? "").trim()
      if (!specId) return json(res, 400, { error: "specId required" })
      const meta = rt.specs.readMeta(specId)
      if (!meta) return json(res, 404, { error: "spec not found" })
      const tasks = rt.specs.loadTasks(specId)
      json(res, 200, { spec: meta, plan: rt.multiagent.plan(tasks) })
    }),
    compile("POST", "/api/multiagent/runs", async (req, res) => {
      const body = await readBody(req)
      const specId = String(body["specId"] ?? "").trim()
      if (!specId) return json(res, 400, { error: "specId required" })
      const meta = rt.specs.readMeta(specId)
      if (!meta) return json(res, 404, { error: "spec not found" })
      try {
        const run = rt.multiagent.create(meta.title, rt.specs.loadTasks(specId), specId)
        rt.pushAudit("multiagent", "Created isolated run " + run.id, specId)
        json(res, 201, { run })
      } catch (error) {
        json(res, 409, { error: (error as Error).message })
      }
    }),
    compile("GET", "/api/multiagent/runs/:id", (_req, res, params) => {
      try { json(res, 200, { run: rt.multiagent.get(params["id"]!) }) }
      catch (error) { json(res, 404, { error: (error as Error).message }) }
    }),
    compile("POST", "/api/multiagent/runs/:id/start", (_req, res, params) => {
      const id = params["id"]!
      let run
      try { run = rt.multiagent.get(id) } catch (error) { return json(res, 404, { error: (error as Error).message }) }
      if (!["planned", "interrupted", "failed"].includes(run.status)) {
        return json(res, 409, { error: "run cannot start from " + run.status })
      }
      const runner = new SpectraIsolatedAgentRunner(rt)
      void rt.multiagent.execute(id, runner, (message) => rt.pushAudit("multiagent", message, id))
        .then((finished) => rt.pushAudit("multiagent", "Run " + finished.status, id))
        .catch((error) => rt.pushAudit("multiagent", "Run failed: " + (error as Error).message, id))
      json(res, 202, { ok: true, runId: id })
    }),
    compile("POST", "/api/multiagent/runs/:id/cancel", (_req, res, params) => {
      try {
        const run = rt.multiagent.cancel(params["id"]!)
        rt.pushAudit("multiagent", "Cancelled run " + run.id)
        json(res, 200, { ok: true, run })
      } catch (error) {
        json(res, 404, { error: (error as Error).message })
      }
    }),
    // ----- Long-Running / Full-Stack autonomous mode -----
    compile("GET", "/api/autorun", (_req, res) => {
      json(res, 200, {
        running: rt.autorun.running,
        hasResumable: rt.autorun.hasResumable(),
        state: rt.autorun.status(),
        config: rt.config.config.autorun,
      })
    }),

    compile("POST", "/api/autorun/start", async (req, res) => {
      const body = await readBody(req)
      const goal = String(body["goal"] ?? "").trim()
      if (!goal) return json(res, 400, { error: "A 'goal' describing the project is required." })
      if (rt.autorun.running) return json(res, 409, { error: "An autorun is already in progress." })
      try {
        const state = rt.autorun.start(goal)
  options.core?.state.record("run.started", { goal: goal.slice(0, 500) }, state.id)
  rt.pushAudit("autorun", `Started full-stack run`, goal.slice(0, 120))
        json(res, 200, { ok: true, state })
      } catch (err) {
        json(res, 400, { error: (err as Error).message })
      }
    }),

    compile("POST", "/api/autorun/resume", async (req, res) => {
      const body = await readBody(req)
      const id = typeof body["id"] === "string" ? (body["id"] as string) : undefined
      const state = rt.autorun.resume(id)
      if (!state) return json(res, 404, { error: "No resumable run found." })
  options.core?.state.record("run.resumed", {}, state.id)
  rt.pushAudit("autorun", `Resumed run ${state.id}`)
      json(res, 200, { ok: true, state })
    }),

    compile("POST", "/api/autorun/stop", (_req, res) => {
      const activeRun = rt.autorun.status()
  rt.autorun.cancel()
  if (activeRun?.id) options.core?.state.record("run.paused", {}, activeRun.id)
  rt.pushAudit("autorun", "Pause requested")
      json(res, 200, { ok: true })
    }),

    // ----- Settings (compaction, permissions) -----
    compile("GET", "/api/settings", (_req, res) => {
      json(res, 200, {
        compaction: rt.config.config.compaction,
        headroom: rt.config.config.headroom,
        permission: rt.config.config.permission,
        spec: rt.config.config.spec,
        autoApprove: rt.config.config.autoApprove, security: rt.config.config.security, trust: rt.trust.status(), toolNames: ["read", "edit", "bash", "grep", "glob", "webfetch"],
        permissionLevels: ["allow", "ask", "deny"],
      })
    }),

    // Supervised mode toggle: on = approve edits/writes/commands; off = auto-approve.
    compile("POST", "/api/settings/supervise", async (req, res) => {
      const body = await readBody(req)
      const on = body["on"] === true
      rt.config.config.autoApprove = !on
      saveAutoApprove(!on, rt.config.projectRoot)
      const level = on ? "ask" : "allow"
      for (const t of ["edit", "write", "bash"]) {
        rt.config.config.permission[t] = level as "allow" | "ask" | "deny"
        savePermission(t, level as "allow" | "ask" | "deny", rt.config.projectRoot)
      }
      rt.pushAudit("settings", `Supervised mode ${on ? "ON" : "OFF"}`)
      json(res, 200, { ok: true, supervised: on, autoApprove: rt.config.config.autoApprove })
    }),

    // ----- Spec intent detection + clarification questionnaire -----
    compile("POST", "/api/spec/detect", async (req, res) => {
      const body = await readBody(req)
      const message = String(body["message"] ?? "")
      const intent = detectSpecIntent(message)
      json(res, 200, { ...intent, mode: rt.config.config.spec.detect ?? "ask" })
    }),

    compile("POST", "/api/spec/clarify", async (req, res) => {
      const body = await readBody(req)
      const message = String(body["message"] ?? "").trim()
      if (!message) return json(res, 400, { error: "message required" })
      const questions = await generateClarifyingQuestions(rt, message)
      json(res, 200, { questions })
    }),

    compile("POST", "/api/spec/auto-preview", async (req, res) => {
      const body = await readBody(req)
      const message = String(body["message"] ?? "").trim()
      if (!message) return json(res, 400, { error: "message required" })
      const questions = await generateClarifyingQuestions(rt, message)
      const clarifications = await autoAnswerQuestions(rt, message, questions)
      json(res, 200, { questions, clarifications })
    }),

    compile("POST", "/api/spec/generate", async (req, res) => {
      const body = await readBody(req)
      const message = String(body["message"] ?? "").trim()
      if (!message) return json(res, 400, { error: "message required" })
      const auto = body["auto"] === true
      let clarifications: Clarification[] = []
      if (Array.isArray(body["clarifications"])) {
        clarifications = (body["clarifications"] as unknown[])
          .map((c) => c as { question?: unknown; answer?: unknown })
          .filter((c) => typeof c.answer === "string" && (c.answer as string).trim())
          .map((c) => ({ question: typeof c.question === "string" ? c.question : "", answer: String(c.answer) }))
      } else if (auto) {
        const questions = await generateClarifyingQuestions(rt, message)
        clarifications = await autoAnswerQuestions(rt, message, questions)
      }
      try {
        const result = await runSpecWorkflow(rt, message, silentLoopHandlers, clarifications)
        rt.pushAudit("spec", `Generated spec ${result.specId}`, message.slice(0, 120))
        json(res, 200, { ok: true, specId: result.specId, tasks: result.tasks.length, clarifications })
      } catch (err) {
        json(res, 500, { error: (err as Error).message })
      }
    }),

    compile("POST", "/api/settings/spec", async (req, res) => {
      const body = await readBody(req)
      const mode = String(body["detect"] ?? "")
      if (!["ask", "auto", "off"].includes(mode)) {
        return json(res, 400, { error: "detect must be ask | auto | off" })
      }
      rt.config.config.spec = { ...rt.config.config.spec, detect: mode as "ask" | "auto" | "off" }
      saveSpecDetect(mode as "ask" | "auto" | "off", rt.config.projectRoot)
      rt.pushAudit("settings", `Spec detection → ${mode}`)
      json(res, 200, { ok: true, detect: mode })
    }),

    // Live Headroom compression stats (tokens saved this run).
    compile("GET", "/api/headroom", (_req, res) => {
      json(res, 200, { config: rt.config.config.headroom, stats: rt.headroom.getStats() })
    }),

    // Real project verification for the Problems panel: runs the detected
    // build/test/lint commands and scans for skeletons + structural smells.
    // On-demand (POST) since it can run real tooling.
    compile("POST", "/api/verify", async (_req, res) => {
      const root = rt.config.projectRoot
      const commands = detectVerifyCommands(root)
      let verify: { ok: boolean; results: CommandResult[] } = { ok: true, results: [] }
      try {
        verify = commands.length > 0 ? await runVerification(commands, root) : { ok: true, results: [] }
      } catch (err) {
        verify = { ok: false, results: [{ command: commands.join(" && "), ok: false, output: String((err as Error).message), durationMs: 0 }] }
      }
      const skeletons = scanForSkeletons(collectSourceFiles(root)).slice(0, 200)
      const structural = scanStructuralIssues(root)
      const blocking = structural.filter((s) => s.blocking).length
      const problems = verify.results.filter((r) => !r.ok).length + skeletons.length + blocking
      json(res, 200, { commands, ok: problems === 0, problems, verify: verify.results, skeletons, structural })
    }),

    // ----- Model routing (manual / semi / auto + autochange failover) -----
    compile("GET", "/api/routing", (_req, res) => {
      const models: string[] = []
      for (const p of rt.providers.list()) {
        for (const m of p.models) models.push(`${p.id}/${m.id}`)
        if (p.models.length === 0) models.push(`${p.id}/`)
      }
      json(res, 200, {
        routing: rt.config.config.routing,
        mainModel: rt.config.config.model,
        smallModel: rt.config.config.small_model,
        taskKinds: ["default", "plan", "build", "fix", "research", "verify", "subagent", "summary"],
        tiers: ["easy", "medium", "hard"],
        models,
      })
    }),

    compile("POST", "/api/routing", async (req, res) => {
      const body = await readBody(req)
      const patch: {
        mode?: "manual" | "semi" | "auto" | "tiered"
        assignments?: Record<string, string>
        autochange?: { enabled?: boolean; fallbacks?: string[] }
        tiers?: { easy?: string; medium?: string; hard?: string }
      } = {}
      if (body["mode"] === "manual" || body["mode"] === "semi" || body["mode"] === "auto" || body["mode"] === "tiered") {
        patch.mode = body["mode"]
      }
      if (body["assignments"] && typeof body["assignments"] === "object") {
        patch.assignments = body["assignments"] as Record<string, string>
      }
      if (body["tiers"] && typeof body["tiers"] === "object") {
        const t = body["tiers"] as Record<string, unknown>
        patch.tiers = {
          ...(typeof t["easy"] === "string" ? { easy: t["easy"] as string } : {}),
          ...(typeof t["medium"] === "string" ? { medium: t["medium"] as string } : {}),
          ...(typeof t["hard"] === "string" ? { hard: t["hard"] as string } : {}),
        }
      }
      if (body["autochange"] && typeof body["autochange"] === "object") {
        const ac = body["autochange"] as { enabled?: boolean; fallbacks?: unknown }
        patch.autochange = {
          ...(typeof ac.enabled === "boolean" ? { enabled: ac.enabled } : {}),
          ...(Array.isArray(ac.fallbacks) ? { fallbacks: (ac.fallbacks as unknown[]).map(String).slice(0, 3) } : {}),
        }
      }
      const current = rt.config.config.routing
      rt.config.config.routing = {
        mode: patch.mode ?? current.mode,
        assignments: patch.assignments ?? current.assignments,
        autochange: { ...current.autochange, ...patch.autochange },
        tiers: { ...current.tiers, ...patch.tiers },
      } as typeof rt.config.config.routing
      saveRouting(patch, rt.config.projectRoot)
      rt.pushAudit("routing", `Updated routing (${rt.config.config.routing.mode})`)
      json(res, 200, { ok: true, routing: rt.config.config.routing })
    }),

    compile("POST", "/api/settings/autorun", async (req, res) => {
      const body = await readBody(req)
      const patch: Record<string, unknown> = {}
      if (typeof body["parallel"] === "boolean") patch["parallel"] = body["parallel"]
      if (typeof body["maxParallel"] === "number") patch["maxParallel"] = body["maxParallel"]
      if (typeof body["reviewPasses"] === "number") patch["reviewPasses"] = body["reviewPasses"]
      if (typeof body["previewUrl"] === "string") patch["previewUrl"] = body["previewUrl"]
      rt.config.config.autorun = { ...rt.config.config.autorun, ...patch }
      saveAutorun(patch, rt.config.projectRoot)
      rt.pushAudit("settings", `Updated autorun ${JSON.stringify(patch)}`)
      json(res, 200, { ok: true, autorun: rt.config.config.autorun })
    }),

    compile("POST", "/api/settings/headroom", async (req, res) => {
      const body = await readBody(req)
      const patch: { enabled?: boolean; minTokens?: number; reversible?: boolean; maxStored?: number; persist?: boolean } = {}
      if (typeof body["enabled"] === "boolean") patch.enabled = body["enabled"]
      if (typeof body["minTokens"] === "number") patch.minTokens = body["minTokens"]
      if (typeof body["reversible"] === "boolean") patch.reversible = body["reversible"]
      if (typeof body["maxStored"] === "number") patch.maxStored = body["maxStored"]
      if (typeof body["persist"] === "boolean") patch.persist = body["persist"]
      rt.config.config.headroom = {
        ...rt.config.config.headroom,
        ...patch,
      } as typeof rt.config.config.headroom
      rt.headroom.configure(patch)
      saveHeadroom(patch, rt.config.projectRoot)
      rt.pushAudit("settings", `Updated headroom ${JSON.stringify(patch)}`)
      json(res, 200, { ok: true, headroom: rt.config.config.headroom })
    }),

    compile("POST", "/api/settings/compaction", async (req, res) => {
      const body = await readBody(req)
      const patch: { auto?: boolean; reserved?: number } = {}
      if (typeof body["auto"] === "boolean") patch.auto = body["auto"]
      if (typeof body["reserved"] === "number") patch.reserved = body["reserved"]
      rt.config.config.compaction = {
        ...rt.config.config.compaction,
        ...patch,
      } as typeof rt.config.config.compaction
      saveCompaction(patch, rt.config.projectRoot)
      rt.pushAudit("settings", `Updated compaction ${JSON.stringify(patch)}`)
      json(res, 200, { ok: true, compaction: rt.config.config.compaction })
    }),

    compile("POST", "/api/permission", async (req, res) => {
      const body = await readBody(req)
      const tool = String(body["tool"] ?? "")
      const level = String(body["level"] ?? "")
      if (!tool || !["allow", "ask", "deny"].includes(level)) {
        return json(res, 400, { error: "tool and level (allow|ask|deny) required" })
      }
      rt.config.config.permission[tool] = level as "allow" | "ask" | "deny"
      savePermission(tool, level as "allow" | "ask" | "deny", rt.config.projectRoot)
      rt.pushAudit("permission", `Set ${tool} → ${level}`)
      json(res, 200, { ok: true })
    }),

    // ----- Providers: disconnect + add custom -----
  compile("POST", "/api/provider/disconnect", async (req, res) => {
    const body = await readBody(req)
    const id = String(body["provider"] ?? "").trim()
    if (!id) return json(res, 400, { error: "provider required" })
    removeProvider(id)
    rt.providers.deleteProvider(id)
    rt.pushAudit("provider", `Disconnected ${id}`)
    json(res, 200, { ok: true })
  }),
  compile("POST", "/api/provider/custom", async (req, res) => {
    const body = await readBody(req)
    const id = String(body["id"] ?? "").trim().toLowerCase()
    const rawBaseURL = String(body["baseURL"] ?? "").trim()
    const apiKey = body["apiKey"] ? String(body["apiKey"]).trim() : ""
    const manualModel = body["model"] ? String(body["model"]).trim() : ""

    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
      return json(res, 400, { error: "Provider id must use lowercase letters, numbers, dot, underscore or dash" })
    }

    let baseURL: string
    try {
      baseURL = normalizeOpenAIBaseURL(rawBaseURL)
    } catch (error) {
      return json(res, 400, { error: (error as Error).message })
    }

    const discovery = await fetchLiveModelsDetailed(baseURL, apiKey || undefined)
    const models = [...new Set([...(manualModel ? [manualModel] : []), ...discovery.models])]
    if (models.length === 0) {
      return json(res, 422, {
        error: discovery.error
          ? `Could not discover models: ${discovery.error}. Enter a model id manually.`
          : "No models found. Enter a model id manually.",
        endpoint: discovery.endpoint,
      })
    }

    const modelConfig: Record<string, { name: string }> = {}
    for (const model of models) modelConfig[model] = { name: model }

    saveCustomProvider({ id, baseURL, apiKey: apiKey || undefined, models })
    rt.providers.upsertProvider(id, {
      sdk: "openai-compatible",
      baseURL,
      ...(apiKey ? { options: { apiKey } } : {}),
      models: modelConfig,
    })

    const warning = discovery.error && manualModel ? discovery.error : undefined
    rt.pushAudit("provider", `Added custom provider ${id} (${models.length} model(s))`, baseURL)
    json(res, 200, {
      ok: true,
      id,
      baseURL,
      models,
      selectedModel: `${id}/${manualModel || models[0]}`,
      discovered: discovery.models.length,
      ...(warning ? { warning } : {}),
    })
  }),

  // ----- Steering files CRUD -----
    compile("POST", "/api/steering", async (req, res) => {
      const body = await readBody(req)
      const name = sanitizeName(String(body["name"] ?? ""))
      const content = String(body["content"] ?? "")
      if (!name) return json(res, 400, { error: "name required" })
      const dir = nodePath.join(rt.config.projectRoot, ".spectra", "steering")
      nodeFs.mkdirSync(dir, { recursive: true })
      nodeFs.writeFileSync(nodePath.join(dir, name.endsWith(".md") ? name : `${name}.md`), content)
      rt.pushAudit("steering", `Saved steering ${name}`)
      json(res, 200, { ok: true })
    }),

    compile("POST", "/api/steering/delete", async (req, res) => {
      const body = await readBody(req)
      const name = sanitizeName(String(body["name"] ?? ""))
      const p = nodePath.join(rt.config.projectRoot, ".spectra", "steering", name)
      if (nodeFs.existsSync(p)) nodeFs.unlinkSync(p)
      rt.pushAudit("steering", `Deleted steering ${name}`)
      json(res, 200, { ok: true })
    }),

    // ----- MCP servers CRUD (.spectra/mcp.json) -----
    compile("POST", "/api/mcp", async (req, res) => {
      const body = await readBody(req)
      const name = String(body["name"] ?? "")
      const command = String(body["command"] ?? "")
      const args = String(body["args"] ?? "")
      if (!name || !command) return json(res, 400, { error: "name and command required" })
      const p = nodePath.join(rt.config.projectRoot, ".spectra", "mcp.json")
      const cfg = readJsonSafe(p)
      cfg.mcpServers[name] = { command, args: args ? args.split(/\s+/) : [] }
      nodeFs.mkdirSync(nodePath.dirname(p), { recursive: true })
      nodeFs.writeFileSync(p, JSON.stringify(cfg, null, 2))
      rt.pushAudit("mcp", `Added MCP server ${name}`)
      json(res, 200, { ok: true })
    }),

    compile("POST", "/api/mcp/delete", async (req, res) => {
      const body = await readBody(req)
      const name = String(body["name"] ?? "")
      const p = nodePath.join(rt.config.projectRoot, ".spectra", "mcp.json")
      if (nodeFs.existsSync(p)) {
        const cfg = readJsonSafe(p)
        delete cfg.mcpServers[name]
        nodeFs.writeFileSync(p, JSON.stringify(cfg, null, 2))
      }
      rt.pushAudit("mcp", `Removed MCP server ${name}`)
      json(res, 200, { ok: true })
    }),

    // ----- Hooks CRUD (.spectra/hooks/<name>.json) -----
    compile("POST", "/api/hooks", async (req, res) => {
      const body = await readBody(req)
      const name = String(body["name"] ?? "")
      const event = String(body["event"] ?? "fileEdited")
      const patterns = String(body["patterns"] ?? "")
      const action = String(body["action"] ?? "runCommand")
      const command = String(body["command"] ?? "")
      const prompt = String(body["prompt"] ?? "")
      if (!name) return json(res, 400, { error: "name required" })
      const hook: Record<string, unknown> = {
        name,
        version: "1.0.0",
        when: { type: event, ...(patterns ? { patterns: patterns.split(",").map((s) => s.trim()) } : {}) },
        then: action === "askAgent" ? { type: "askAgent", prompt } : { type: "runCommand", command },
      }
      const dir = nodePath.join(rt.config.projectRoot, ".spectra", "hooks")
      nodeFs.mkdirSync(dir, { recursive: true })
      nodeFs.writeFileSync(nodePath.join(dir, `${sanitizeName(name)}.json`), JSON.stringify(hook, null, 2))
      rt.hooks.reload()
      rt.pushAudit("hook", `Added hook ${name}`)
      json(res, 200, { ok: true })
    }),

    compile("POST", "/api/hooks/delete", async (req, res) => {
      const body = await readBody(req)
      const file = sanitizeName(String(body["file"] ?? ""))
      const dir = nodePath.join(rt.config.projectRoot, ".spectra", "hooks")
      for (const f of nodeFs.existsSync(dir) ? nodeFs.readdirSync(dir) : []) {
        if (f === file || f === `${file}.json`) nodeFs.unlinkSync(nodePath.join(dir, f))
      }
      rt.hooks.reload()
      rt.pushAudit("hook", `Removed hook ${file}`)
      json(res, 200, { ok: true })
    }),

    // ----- State -----
    compile("GET", "/api/state", (_req, res) => {
      const model = rt.config.config.model
      const providerId = model.split("/")[0] ?? ""
      json(res, 200, {
        agent: rt.agents.current_().id,
        model,
        connected: rt.providers.hasCredentials(providerId),
        agents: rt.agents.all().map((a) => ({ id: a.id, description: a.description, mode: a.mode })),
        providers: rt.providers
          .list()
          .map((p) => ({ id: p.id, name: p.name, connected: rt.providers.hasCredentials(p.id) })),
      })
    }),

    // ----- Current session transcript (to restore the chat view on reload) -----
    compile("GET", "/api/session", (_req, res) => {
      const s = rt.sessions.current()
      json(res, 200, {
        id: s?.id ?? null,
        title: s?.title ?? "",
        messages: s
          ? s.messages
              .filter((m) => m.role !== "tool" && m.content.trim().length > 0)
              .map((m) => ({ role: m.role, content: m.content }))
          : [],
      })
    }),

    // ----- Full model catalog (static + runtime/custom providers) -----
  compile("GET", "/api/catalog", (_req, res) => {
    const entries = new Map<string, { id: string; providerId: string; label: string; free: boolean; connected: boolean }>()
    for (const entry of staticCatalog()) {
      entries.set(entry.id, {
        id: entry.id,
        providerId: entry.providerId,
        label: entry.label,
        free: entry.free,
        connected: entry.free || rt.providers.hasCredentials(entry.providerId),
      })
    }
    for (const provider of rt.providers.list()) {
      for (const model of provider.models) {
        const id = `${provider.id}/${model.id}`
        if (entries.has(id)) continue
        entries.set(id, {
          id,
          providerId: provider.id,
          label: `${provider.name} · ${model.name}`,
          free: provider.id === "free",
          connected: rt.providers.hasCredentials(provider.id),
        })
      }
    }
    json(res, 200, [...entries.values()])
  }),

  // ----- Connect a provider -----
    compile("POST", "/api/connect", async (req, res) => {
      const body = await readBody(req)
      const provider = String(body["provider"] ?? "")
      const apiKey = String(body["apiKey"] ?? "")
      const baseURL = body["baseURL"] ? String(body["baseURL"]) : undefined
      if (!provider) return json(res, 400, { error: "provider required" })
      saveProviderKey(provider, apiKey, baseURL)
      rt.providers.upsertProvider(provider, {
        ...(baseURL ? { baseURL, sdk: "openai-compatible" } : {}),
        options: { apiKey },
      })
      rt.pushAudit("provider", `Connected ${provider}`, baseURL)
      json(res, 200, { ok: true })
    }),

    // ----- Switch model (optionally with an inline key) -----
    compile("POST", "/api/model", async (req, res) => {
      const body = await readBody(req)
      const model = String(body["model"] ?? "")
      if (!model) return json(res, 400, { error: "model required" })
      const providerId = model.split("/")[0] ?? ""
      const apiKey = body["apiKey"] ? String(body["apiKey"]) : ""
      if (apiKey) {
        saveProviderKey(providerId, apiKey)
        rt.providers.upsertProvider(providerId, { options: { apiKey } })
      }
      rt.config.config.model = model
      const sid = ensureSession()
      rt.sessions.setModel(sid, model)
      saveModel(model)
      rt.pushAudit("model", `Switched model → ${model}`)
      json(res, 200, { ok: true })
    }),

    // ----- Switch agent -----
    compile("POST", "/api/agent", async (req, res) => {
      const body = await readBody(req)
      const agent = String(body["agent"] ?? "")
      const ok = rt.agents.setCurrent(agent)
      if (ok) rt.pushAudit("agent", `Switched agent → ${agent}`)
      json(res, ok ? 200 : 400, { ok })
    }),

    // ----- Supervised-mode approval response -----
    compile("POST", "/api/approval", async (req, res) => {
      const body = await readBody(req)
      const id = String(body["id"] ?? "")
      const allow = body["allow"] === true
      const resolve = approvals.get(id)
      if (!resolve) return json(res, 404, { error: "unknown or expired approval" })
      approvals.delete(id)
      resolve(allow)
      json(res, 200, { ok: true })
    }),

    // ----- Chat (SSE stream of events) -----
    compile("POST", "/api/chat", async (req, res) => {
      const body = await readBody(req)
      const message = String(body["message"] ?? "").trim()
      const rawImages = Array.isArray(body["images"]) ? (body["images"] as unknown[]) : []
      const images = rawImages
        .map((i) => i as { mediaType?: string; data?: string })
        .filter((i) => typeof i.data === "string" && i.data.length > 0)
        .map((i) => ({ mediaType: i.mediaType || "image/png", data: i.data! }))
      if (!message && images.length === 0) return json(res, 400, { error: "message required" })

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      })

      const emit = (event: Record<string, unknown>): void => {
        if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`)
      }

      // Clean close: nothing extra needed — emit() already guards on destroyed.

      const handlers: LoopHandlers = {
        onText: (text) => emit({ type: "text", text }),
        onTextChunk: (text) => emit({ type: "chunk", text }),
        onToolStart: (name, args) =>
          emit({ type: "tool", text: `⚙ ${name} ${argHint(name, args)}` }),
        onToolEnd: (name, success, output) =>
          emit({ type: "tool", text: `${success ? "✓" : "✗"} ${name}: ${output.split("\n")[0]?.slice(0, 100) ?? ""}` }),
        report: (m) => emit({ type: "tool", text: m }),
        requestApproval: (toolName, detail) => {
          return new Promise<boolean>((resolve) => {
            const id = randomBytes(6).toString("hex")
            const timer = setTimeout(() => {
              if (approvals.delete(id)) resolve(false) // default-deny after 5 min
            }, 300_000)
            approvals.set(id, (ok) => {
              clearTimeout(timer)
              resolve(ok)
            })
            emit({ type: "approval", id, tool: toolName, detail })
          })
        },
      }

      try {
        const sid = ensureSession()
        const before = rt.sessions.get(sid)?.usage ?? { inputTokens: 0, outputTokens: 0 }
        // Cancel the server-side turn if the client disconnects / interrupts.
        const ac = new AbortController()
        req.on("close", () => ac.abort())
        await rt.loop.run({
          sessionId: sid,
          agent: rt.agents.current_(),
          userMessage: message,
          images: images.length > 0 ? images : undefined,
          handlers,
          signal: ac.signal,
        })
        const after = rt.sessions.get(sid)?.usage ?? before
        emit({
          type: "usage",
          in: after.inputTokens - before.inputTokens,
          out: after.outputTokens - before.outputTokens,
        })
        emit({ type: "done" })
      } catch (err) {
        emit({ type: "error", text: (err as Error).message })
      } finally {
        res.end()
      }
    }),
  ]

  const server = createHttpServer(async (req, res) => {
    // CORS: only allow configured origins (not '*').
    const origin = req.headers.origin
    const allowedOrigins = [
      ...options.cors,
      `http://127.0.0.1:${options.port}`,
      `http://localhost:${options.port}`,
    ]
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("access-control-allow-origin", origin)
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS")
      res.setHeader("access-control-allow-headers", "content-type, authorization")
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
    const pathname = url.pathname

    // Exempt pages served to the browser (web UI shell, health check).
    const exempt = pathname === "/" || pathname === "/desktop" || pathname === "/health"
    if (!exempt && !checkAuth(req, url)) {
      json(res, 401, { error: "Unauthorized. Supply Authorization: Bearer <token>." })
      return
    }
    for (const route of routes) {
      if (route.method !== req.method) continue
      const match = route.pattern.exec(url.pathname)
      if (!match) continue
      const params: Record<string, string> = {}
      route.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(match[i + 1] ?? "")
      })
      try {
        await route.handler(req, res, params)
      } catch (err) {
        if (!res.headersSent) json(res, 500, { error: (err as Error).message })
        else res.end()
      }
      return
    }

    json(res, 404, { error: "not found" })
  })

  return {
    listen(): Promise<void> {
      return new Promise((resolve, reject) => {
        const onError = (err: Error): void => reject(err)
        server.once("error", onError)
        server.listen(options.port, options.hostname, () => {
          server.removeListener("error", onError)
          resolve()
        })
      })
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
    },
    raw: server,
  }
}

function argHint(name: string, args: Record<string, unknown>): string {
  if (name === "bash") return String(args["command"] ?? "")
  return String(args["path"] ?? args["pattern"] ?? args["url"] ?? "")
}

/** Strip path separators and unsafe chars from a user-supplied file name. */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)
}

/** Read a JSON file with an mcpServers object, or return an empty shell. */
function readJsonSafe(path: string): { mcpServers: Record<string, unknown> } {
  try {
    if (nodeFs.existsSync(path)) {
      const parsed = JSON.parse(nodeFs.readFileSync(path, "utf-8")) as { mcpServers?: Record<string, unknown> }
      return { mcpServers: parsed.mcpServers ?? {} }
    }
  } catch {
    /* ignore */
  }
  return { mcpServers: {} }
}
