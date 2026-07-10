import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto"
import { createReadStream, statSync } from "node:fs"
import type { ArtifactArch, ArtifactPlatform, ReleaseArtifact, ReleaseManifest, UnsignedReleaseManifest } from "./types.js"

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
  }
  return value
}

export function canonicalManifestPayload(manifest: ReleaseManifest | UnsignedReleaseManifest): Buffer {
  const { signature: _signature, ...unsigned } = manifest as ReleaseManifest
  return Buffer.from(JSON.stringify(stable(unsigned)), "utf8")
}

export function signReleaseManifest(unsigned: UnsignedReleaseManifest, keyId: string, privateKeyPem: string): ReleaseManifest {
  validateUnsignedManifest(unsigned)
  const base = { ...unsigned, keyId, signature: "" }
  const signature = sign(null, canonicalManifestPayload(base), createPrivateKey(privateKeyPem)).toString("base64")
  return { ...unsigned, keyId, signature }
}

export function verifyReleaseManifest(manifest: ReleaseManifest, publicKeyPem: string): boolean {
  validateReleaseManifest(manifest)
  try {
    return verify(null, canonicalManifestPayload(manifest), createPublicKey(publicKeyPem), Buffer.from(manifest.signature, "base64"))
  } catch {
    return false
  }
}

export function validateUnsignedManifest(manifest: UnsignedReleaseManifest): void {
  if (manifest.schemaVersion !== 1 || manifest.product !== "spectra") throw new Error("Unsupported Spectra update manifest")
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error("Invalid release version")
  if (!Number.isInteger(manifest.protocolVersion) || manifest.protocolVersion < 1) throw new Error("Invalid protocol version")
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) throw new Error("Release manifest has no artifacts")
  for (const artifact of manifest.artifacts) validateArtifact(artifact)
}

export function validateReleaseManifest(manifest: ReleaseManifest): void {
  validateUnsignedManifest(manifest)
  if (!manifest.keyId.trim() || !manifest.signature.trim()) throw new Error("Release manifest is unsigned")
}

function validateArtifact(artifact: ReleaseArtifact): void {
  if (!artifact.name || artifact.name.includes("..") || /[\\/]/.test(artifact.name)) throw new Error("Invalid artifact name")
  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256)) throw new Error(`Invalid SHA-256 for ${artifact.name}`)
  if (!Number.isSafeInteger(artifact.size) || artifact.size < 1) throw new Error(`Invalid size for ${artifact.name}`)
  const url = new URL(artifact.url)
  if (url.protocol !== "https:") throw new Error(`Artifact URL must use HTTPS: ${artifact.name}`)
}

export function sha256Buffer(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex")
}

export async function sha256File(file: string): Promise<string> {
  const digest = createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on("data", (chunk) => digest.update(chunk))
    stream.on("error", reject)
    stream.on("end", resolve)
  })
  return digest.digest("hex")
}

export async function verifyArtifactFile(file: string, artifact: ReleaseArtifact): Promise<void> {
  const stat = statSync(file)
  if (stat.size !== artifact.size) throw new Error(`Artifact size mismatch for ${artifact.name}`)
  const digest = await sha256File(file)
  if (digest.toLowerCase() !== artifact.sha256.toLowerCase()) throw new Error(`Artifact checksum mismatch for ${artifact.name}`)
}

export function currentArtifactTarget(platform: NodeJS.Platform = process.platform, arch = process.arch): { platform: ArtifactPlatform; arch: ArtifactArch } {
  const mappedPlatform: ArtifactPlatform = platform === "linux" || platform === "darwin" || platform === "win32" ? platform : "any"
  const mappedArch: ArtifactArch = arch === "x64" || arch === "arm64" ? arch : "any"
  return { platform: mappedPlatform, arch: mappedArch }
}

export function selectArtifact(manifest: ReleaseManifest, platform = process.platform, arch = process.arch): ReleaseArtifact | undefined {
  const target = currentArtifactTarget(platform, arch)
  const matches = manifest.artifacts.filter((artifact) => (artifact.platform === target.platform || artifact.platform === "any") && (artifact.arch === target.arch || artifact.arch === "any"))
  const priority = target.platform === "linux" ? ["appimage", "deb", "pacman", "tar.gz"] : target.platform === "win32" ? ["nsis", "msi", "zip"] : ["dmg", "app", "tar.gz"]
  const rank = (format: string): number => { const index = priority.indexOf(format); return index < 0 ? 999 : index }
  return matches.sort((a, b) => rank(a.format) - rank(b.format))[0]
}

export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] => value.replace(/^v/, "").split("-")[0]!.split(".").map((part) => Number(part) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  return 0
}
