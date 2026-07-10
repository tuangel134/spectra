import { test } from "node:test"
import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"
import { writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compareVersions, selectArtifact, signReleaseManifest, verifyArtifactFile, verifyReleaseManifest } from "../src/production/manifest.ts"
import type { UnsignedReleaseManifest } from "../src/production/types.ts"

function keys(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } })
  return { publicKey: pair.publicKey, privateKey: pair.privateKey }
}
function manifest(): UnsignedReleaseManifest { return { schemaVersion: 1, product: "spectra", version: "1.0.1", channel: "stable", publishedAt: new Date().toISOString(), protocolVersion: 1, minNode: "20", artifacts: [{ name: "spectra-linux-x64.AppImage", platform: "linux", arch: "x64", format: "appimage", url: "https://example.invalid/spectra-linux-x64.AppImage", sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", size: 5 }] } }

test("release manifests are signed and tampering is rejected", () => {
  const key = keys(); const signed = signReleaseManifest(manifest(), "spectra-release-1", key.privateKey)
  assert.equal(verifyReleaseManifest(signed, key.publicKey), true)
  assert.equal(verifyReleaseManifest({ ...signed, version: "9.9.9" }, key.publicKey), false)
})

test("artifact selection and semantic version comparison are deterministic", () => {
  const key = keys(); const base = manifest()
  base.artifacts.unshift({ ...base.artifacts[0]!, name: "spectra-linux-x64.unknown", format: "unknown" })
  const signed = signReleaseManifest(base, "key", key.privateKey)
  assert.equal(selectArtifact(signed, "linux", "x64")?.format, "appimage")
  assert.equal(compareVersions("1.0.1", "1.0.0"), 1)
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0)
})

test("artifact verification rejects changed bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "spectra-artifact-")); const file = join(root, "artifact")
  try { writeFileSync(file, "hello"); const artifact = manifest().artifacts[0]!; await verifyArtifactFile(file, artifact); writeFileSync(file, "HELLO"); await assert.rejects(verifyArtifactFile(file, artifact), /checksum mismatch/) } finally { await rm(root, { recursive: true, force: true }) }
})
