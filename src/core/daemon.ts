import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { createRuntime, connectIntegrations } from "../runtime.js"
import { createServer } from "../server/index.js"
import { writeCoreLease, removeCoreLease } from "./lease.js"
import { CORE_PROTOCOL_VERSION, type CoreLease } from "./protocol.js"
import { CoreStateStore } from "./state-store.js"

interface DaemonArgs {
  cwd: string
  port: number
}

export function parseDaemonArgs(args: string[]): DaemonArgs {
  let cwd = process.cwd()
  let port = 4123
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (value === "--cwd" && args[index + 1]) cwd = args[++index]!
    else if (value === "--port" && args[index + 1]) port = Number(args[++index])
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid --port for Spectra Core")
  return { cwd: resolve(cwd), port }
}

export async function runCoreDaemonCli(args: string[]): Promise<void> {
  const options = parseDaemonArgs(args)
  const startedAt = Date.now()
  const instanceId = `core_${randomUUID()}`
  const runtime = createRuntime({ cwd: options.cwd })

  let activeProjectRoot = runtime.config.projectRoot
  let state = new CoreStateStore(activeProjectRoot)
  state.setMeta("protocolVersion", String(CORE_PROTOCOL_VERSION))
  state.setMeta("instanceId", instanceId)
  state.record("core.starting", { pid: process.pid, port: options.port, stateBackend: state.backend })

  const lease: CoreLease = {
    protocolVersion: CORE_PROTOCOL_VERSION,
    instanceId,
    pid: process.pid,
    port: options.port,
    hostname: "127.0.0.1",
    projectRoot: activeProjectRoot,
    startedAt,
    heartbeatAt: Date.now(),
    stateBackend: state.backend,
  }

  const moveToProject = (projectRoot: string): void => {
    const nextRoot = resolve(projectRoot)
    if (nextRoot === resolve(activeProjectRoot)) return
    const previousRoot = activeProjectRoot
    try { state.record("core.project.detached", { nextProjectRoot: nextRoot }) } catch { /* best effort */ }
    try { state.close() } catch { /* best effort */ }
    removeCoreLease(previousRoot, instanceId)

    activeProjectRoot = nextRoot
    state = new CoreStateStore(activeProjectRoot)
    state.setMeta("protocolVersion", String(CORE_PROTOCOL_VERSION))
    state.setMeta("instanceId", instanceId)
    lease.projectRoot = activeProjectRoot
    lease.heartbeatAt = Date.now()
    lease.stateBackend = state.backend
    writeCoreLease(activeProjectRoot, lease)
    state.record("core.project.attached", { previousProjectRoot: previousRoot })
  }

  await connectIntegrations(runtime, (message) => state.record("integration.report", { message }))
  const coreContext = {
    protocolVersion: CORE_PROTOCOL_VERSION,
    instanceId,
    startedAt,
    get state(): CoreStateStore { return state },
    onProjectChanged: moveToProject,
  }
  const server = createServer(runtime, {
    port: options.port,
    hostname: "127.0.0.1",
    cors: [`http://127.0.0.1:${options.port}`],
    core: coreContext,
  })

  await server.listen()
  writeCoreLease(activeProjectRoot, lease)
  state.record("core.ready", { pid: process.pid, port: options.port, projectRoot: activeProjectRoot })

  const heartbeat = setInterval(() => {
    lease.heartbeatAt = Date.now()
    lease.projectRoot = activeProjectRoot
    lease.stateBackend = state.backend
    try { writeCoreLease(activeProjectRoot, lease) } catch { /* best effort */ }
  }, 2_000)
  if (typeof heartbeat === "object" && "unref" in heartbeat) heartbeat.unref()

  // Mirror meaningful Autorun state transitions into the Core journal. This
  // makes crash recovery accurate without writing a noisy event every second.
  let lastRunSignature = ""
  const runMonitor = setInterval(() => {
    try {
      const current = runtime.autorun.status()
      if (!current?.id) return
      const signature = `${current.id}:${current.status}:${current.finished}`
      if (signature === lastRunSignature) return
      lastRunSignature = signature
      const terminal = current.status === "completed"
        ? "run.completed"
        : current.status === "failed"
          ? "run.failed"
          : current.status === "paused"
            ? "run.paused"
            : "run.progress"
      state.record(terminal, {
        status: current.status,
        finished: current.finished,
        currentPhase: current.currentPhase,
        phaseCount: current.phases.length,
      }, current.id)
    } catch { /* best effort */ }
  }, 1_000)
  if (typeof runMonitor === "object" && "unref" in runMonitor) runMonitor.unref()

  let shuttingDown = false
  let finishShutdown: (() => void) | undefined
  const shutdownDone = new Promise<void>((resolveShutdown) => { finishShutdown = resolveShutdown })
  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return shutdownDone
    shuttingDown = true
    clearInterval(heartbeat)
    clearInterval(runMonitor)
    try { state.record("core.stopping", { reason }) } catch { /* best effort */ }
    try { runtime.autorun?.cancel() } catch { /* best effort */ }
    try { runtime.sessions.flush() } catch { /* best effort */ }
    try { runtime.mcp.close() } catch { /* best effort */ }
    try { runtime.lsp.close() } catch { /* best effort */ }
    try { await server.close() } catch { /* best effort */ }
    try { state.record("core.stopped", { reason, exitCode }) } catch { /* best effort */ }
    try { state.close() } catch { /* best effort */ }
    removeCoreLease(activeProjectRoot, instanceId)
    process.exitCode = exitCode
    finishShutdown?.()
  }

  process.once("SIGINT", () => { void shutdown("SIGINT") })
  process.once("SIGTERM", () => { void shutdown("SIGTERM") })
  process.once("uncaughtException", (error) => {
    try { state.record("core.failed", { error: error.stack ?? error.message }) } catch { /* ignore */ }
    void shutdown("uncaughtException", 1)
  })
  process.once("unhandledRejection", (reason) => {
    try { state.record("core.failed", { error: String(reason) }) } catch { /* ignore */ }
    void shutdown("unhandledRejection", 1)
  })

  await shutdownDone
}
