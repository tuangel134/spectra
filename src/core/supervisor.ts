import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { createServer as createNetServer } from "node:net"
import { resolve } from "node:path"
import { CoreClient } from "./client.js"
import {
  coreLeasePath,
  isProcessAlive,
  readCoreLease,
  removeCoreLease,
} from "./lease.js"
import {
  CORE_PROTOCOL_VERSION,
  assertProtocolCompatible,
  type CoreHealth,
  type CoreLease,
} from "./protocol.js"

export interface CoreConnection {
  lease: CoreLease
  client: CoreClient
  url: string
  reused: boolean
}

interface EnsureCoreOptions {
  preferredPort?: number
  startupTimeoutMs?: number
  entryPath?: string
  report?: (message: string) => void
}

export interface CoreSpawnSpec {
  command: string
  args: string[]
}

export function createCoreSpawnSpec(projectRoot: string, port: number, entryPath = process.argv[1] ?? ""): CoreSpawnSpec {
  if (!entryPath) throw new Error("Could not determine the Spectra CLI entry point")
  const loaderArgs = entryPath.endsWith(".ts") ? process.execArgv : []
  return {
    command: process.execPath,
    args: [...loaderArgs, entryPath, "core-daemon", "--cwd", resolve(projectRoot), "--port", String(port)],
  }
}

export async function ensureCore(projectRoot: string, options: EnsureCoreOptions = {}): Promise<CoreConnection> {
  const existing = await discoverCore(projectRoot)
  if (existing) return { ...existing, reused: true }

  const port = await findFreePort(options.preferredPort ?? 4123)
  const spec = createCoreSpawnSpec(projectRoot, port, options.entryPath)
  options.report?.(`Starting Spectra Core on 127.0.0.1:${port}`)
  const child = spawn(spec.command, spec.args, {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, SPECTRA_CORE_DAEMON: "1" },
  })
  child.unref()

  const deadline = Date.now() + (options.startupTimeoutMs ?? 20_000)
  let lastError: Error | undefined
  while (Date.now() < deadline) {
    await delay(150)
    try {
      const connection = await discoverCore(projectRoot)
      if (connection) return { ...connection, reused: false }
    } catch (error) {
      lastError = error as Error
    }
    if (child.exitCode !== null) break
  }
  throw new Error(`Spectra Core did not become ready${lastError ? `: ${lastError.message}` : ""}`)
}

export async function discoverCore(projectRoot: string): Promise<Omit<CoreConnection, "reused"> | null> {
  const lease = readCoreLease(projectRoot)
  if (!lease) return null
  if (!isProcessAlive(lease.pid)) {
    removeCoreLease(projectRoot, lease.instanceId)
    return null
  }
  try {
    const client = new CoreClient(lease.hostname, lease.port)
    const health = await client.health()
    assertProtocolCompatible(health.protocolVersion)
    if (health.instanceId && health.instanceId !== lease.instanceId) {
      removeCoreLease(projectRoot, lease.instanceId)
      return null
    }
    const requestedRoot = canonicalRoot(projectRoot)
    const runningRoot = health.projectRoot ? canonicalRoot(health.projectRoot) : canonicalRoot(lease.projectRoot)
    if (requestedRoot !== runningRoot) {
      removeCoreLease(projectRoot, lease.instanceId)
      return null
    }
    return { lease, client, url: client.baseURL }
  } catch {
    if (Date.now() - lease.heartbeatAt > 15_000) removeCoreLease(projectRoot, lease.instanceId)
    return null
  }
}

export async function stopCore(projectRoot: string): Promise<boolean> {
  const lease = readCoreLease(projectRoot)
  if (!lease) return false
  if (!isProcessAlive(lease.pid)) {
    removeCoreLease(projectRoot, lease.instanceId)
    return false
  }
  try { process.kill(lease.pid, "SIGTERM") } catch { return false }
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline && isProcessAlive(lease.pid)) await delay(100)
  if (isProcessAlive(lease.pid)) {
    try { process.kill(lease.pid, "SIGKILL") } catch { /* best effort */ }
  }
  removeCoreLease(projectRoot, lease.instanceId)
  return true
}

export async function restartCore(projectRoot: string, options: EnsureCoreOptions = {}): Promise<CoreConnection> {
  await stopCore(projectRoot)
  return ensureCore(projectRoot, options)
}

export async function coreStatus(projectRoot: string): Promise<{
  running: boolean
  leasePath: string
  lease?: CoreLease
  health?: CoreHealth
}> {
  const leasePath = coreLeasePath(projectRoot)
  const connection = await discoverCore(projectRoot)
  if (!connection) return { running: false, leasePath }
  const health = await connection.client.health()
  return { running: true, leasePath, lease: connection.lease, health }
}

export function startCoreHeartbeat(connection: CoreConnection, clientId = `desktop_${randomUUID()}`): () => void {
  let stopped = false
  const beat = (): void => {
    if (stopped) return
    void connection.client.post("/api/core/client/heartbeat", { clientId }).catch(() => {})
  }
  beat()
  const timer = setInterval(beat, 5_000)
  if (typeof timer === "object" && "unref" in timer) timer.unref()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

export async function runCoreCommand(args: string[], projectRoot = process.cwd()): Promise<void> {
  const command = args[0] ?? "status"
  if (command === "status") {
    const status = await coreStatus(projectRoot)
    process.stdout.write(status.running
      ? `Spectra Core running\n  pid: ${status.lease?.pid}\n  url: http://127.0.0.1:${status.lease?.port}\n  protocol: ${status.health?.protocolVersion ?? CORE_PROTOCOL_VERSION}\n  state: ${status.health?.stateBackend ?? "unknown"}\n`
      : "Spectra Core is not running for this project.\n")
    return
  }
  if (command === "start") {
    const connection = await ensureCore(projectRoot)
    process.stdout.write(`Spectra Core ready at ${connection.url}${connection.reused ? " (reused)" : ""}\n`)
    return
  }
  if (command === "stop") {
    const stopped = await stopCore(projectRoot)
    process.stdout.write(stopped ? "Spectra Core stopped.\n" : "Spectra Core was not running.\n")
    return
  }
  if (command === "restart") {
    const connection = await restartCore(projectRoot)
    process.stdout.write(`Spectra Core restarted at ${connection.url}\n`)
    return
  }
  throw new Error("Usage: spectra core <status|start|stop|restart>")
}

async function findFreePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 100; port++) {
    if (await portAvailable(port)) return port
  }
  throw new Error("No free localhost port found for Spectra Core")
}

function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolveAvailable) => {
    const server = createNetServer()
    server.once("error", () => resolveAvailable(false))
    server.once("listening", () => server.close(() => resolveAvailable(true)))
    server.listen(port, "127.0.0.1")
  })
}

function canonicalRoot(projectRoot: string): string {
  const root = resolve(projectRoot)
  return process.platform === "win32" ? root.toLowerCase() : root
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
