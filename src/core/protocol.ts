export const CORE_PROTOCOL_VERSION = 1 as const
export const CORE_PROTOCOL_MIN_COMPATIBLE = 1 as const

export type CoreLifecycleState = "starting" | "ready" | "stopping" | "stopped" | "failed"

export interface CoreLease {
  protocolVersion: number
  instanceId: string
  pid: number
  port: number
  hostname: "127.0.0.1"
  projectRoot: string
  startedAt: number
  heartbeatAt: number
  stateBackend: "sqlite" | "jsonl"
}

export interface CoreHealth {
  status: "ok"
  version: string
  protocolVersion: number
  instanceId?: string
  pid: number
  projectRoot?: string
  stateBackend?: "sqlite" | "jsonl"
  startedAt?: number
  token?: string
  autorun?: {
    running: boolean
    hasResumable: boolean
  }
}

export interface CoreEvent<T = Record<string, unknown>> {
  id: string
  type: string
  timestamp: number
  runId?: string
  payload: T
}

export interface CoreRecoverySummary {
  interrupted: boolean
  latestRunId?: string
  latestEvent?: CoreEvent
  activeClients: number
  resumableAutorun: boolean
}

export function isProtocolCompatible(remoteVersion: number): boolean {
  return Number.isInteger(remoteVersion) && remoteVersion >= CORE_PROTOCOL_MIN_COMPATIBLE && remoteVersion <= CORE_PROTOCOL_VERSION
}

export function assertProtocolCompatible(remoteVersion: number): void {
  if (!isProtocolCompatible(remoteVersion)) {
    throw new Error(
      `Incompatible Spectra Core protocol ${remoteVersion}; desktop supports ${CORE_PROTOCOL_MIN_COMPATIBLE}-${CORE_PROTOCOL_VERSION}`,
    )
  }
}
