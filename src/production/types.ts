export type UpdateChannel = "stable" | "beta" | "nightly"
export type ArtifactPlatform = "linux" | "darwin" | "win32" | "any"
export type ArtifactArch = "x64" | "arm64" | "any"

export interface ReleaseArtifact {
  name: string
  platform: ArtifactPlatform
  arch: ArtifactArch
  format: string
  url: string
  sha256: string
  size: number
  signatureUrl?: string
  certificateUrl?: string
}

export interface UnsignedReleaseManifest {
  schemaVersion: 1
  product: "spectra"
  version: string
  channel: UpdateChannel
  publishedAt: string
  protocolVersion: number
  minNode: string
  notesUrl?: string
  artifacts: ReleaseArtifact[]
}

export interface ReleaseManifest extends UnsignedReleaseManifest {
  keyId: string
  signature: string
}

export interface RecoveryRecord {
  schemaVersion: 1
  projectRoot: string
  projectKey: string
  version: string
  pid: number
  instanceId: string
  startedAt: number
  heartbeatAt: number
  clean: boolean
  reason?: string
  error?: string
}

export interface ProductionCheck {
  id: string
  status: "ok" | "warn" | "fail"
  detail: string
}

export interface ProductionStatus {
  version: string
  channel: UpdateChannel
  platform: NodeJS.Platform
  arch: string
  node: string
  secretBackend: { name: string; secure: boolean }
  recovery: { interrupted: boolean; record: RecoveryRecord | null }
  checks: ProductionCheck[]
}
