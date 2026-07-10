import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { configDir } from "../util/platform.js"
import { compareVersions, selectArtifact, verifyArtifactFile, verifyReleaseManifest } from "./manifest.js"
import type { ReleaseArtifact, ReleaseManifest } from "./types.js"

export const DEFAULT_MANIFEST_URL = "https://github.com/tuangel134/spectra/releases/latest/download/update-manifest.json"
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024

function secureRemote(url: string, allowLoopback = false): URL {
  const parsed = new URL(url)
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
  if (parsed.protocol !== "https:" && !(allowLoopback && loopback && parsed.protocol === "http:")) throw new Error("Spectra updates require HTTPS")
  return parsed
}

export async function fetchVerifiedManifest(url: string, publicKeyPem: string, fetcher: typeof fetch = fetch): Promise<ReleaseManifest> {
  const parsed = secureRemote(url, process.env["NODE_ENV"] === "test")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetcher(parsed, { headers: { accept: "application/json", "user-agent": "Spectra-Updater/1.0" }, signal: controller.signal, redirect: "error" })
    if (!response.ok) throw new Error(`Update manifest HTTP ${response.status}`)
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_MANIFEST_BYTES) throw new Error("Update manifest is too large")
    const manifest = JSON.parse(text) as ReleaseManifest
    if (!verifyReleaseManifest(manifest, publicKeyPem)) throw new Error("Update manifest signature is invalid")
    return manifest
  } finally { clearTimeout(timeout) }
}

export interface UpdateCheck {
  currentVersion: string
  latestVersion: string
  available: boolean
  manifest: ReleaseManifest
  artifact?: ReleaseArtifact
}

export async function checkForUpdate(currentVersion: string, publicKeyPem: string, manifestUrl = DEFAULT_MANIFEST_URL, fetcher: typeof fetch = fetch): Promise<UpdateCheck> {
  const manifest = await fetchVerifiedManifest(manifestUrl, publicKeyPem, fetcher)
  return { currentVersion, latestVersion: manifest.version, available: compareVersions(manifest.version, currentVersion) > 0, manifest, artifact: selectArtifact(manifest) }
}

export async function downloadVerifiedArtifact(artifact: ReleaseArtifact, destinationRoot = join(configDir(), "updates"), fetcher: typeof fetch = fetch): Promise<string> {
  secureRemote(artifact.url, process.env["NODE_ENV"] === "test")
  if (artifact.size > MAX_ARTIFACT_BYTES) throw new Error("Update artifact exceeds the safety limit")
  mkdirSync(destinationRoot, { recursive: true })
  const destination = join(destinationRoot, artifact.name)
  const temporary = destination + ".partial"
  rmSync(temporary, { force: true })
  const response = await fetcher(artifact.url, { headers: { "user-agent": "Spectra-Updater/1.0" }, redirect: "error" })
  if (!response.ok || !response.body) throw new Error(`Update artifact HTTP ${response.status}`)
  const length = Number(response.headers.get("content-length") ?? "0")
  if (length && length !== artifact.size) throw new Error("Update artifact size header does not match manifest")
  let received = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > artifact.size || received > MAX_ARTIFACT_BYTES) callback(new Error("Update artifact exceeded its signed size"))
      else callback(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(response.body as never), limiter, createWriteStream(temporary, { mode: 0o700 }))
    if (received !== artifact.size) throw new Error("Update artifact size does not match manifest")
    await verifyArtifactFile(temporary, artifact)
    renameSync(temporary, destination)
    return destination
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

export function readUpdatePublicKey(installRoot: string): string {
  const candidates = [join(installRoot, "assets", "update-public-key.pem"), join(dirname(installRoot), "assets", "update-public-key.pem")]
  const found = candidates.find(existsSync)
  if (!found) throw new Error("Spectra update public key is missing")
  return readFileSync(found, "utf8")
}
