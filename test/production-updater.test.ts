import { test } from "node:test"
import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { signReleaseManifest } from "../src/production/manifest.ts"
import { checkForUpdate, downloadVerifiedArtifact } from "../src/production/updater.ts"
import type { UnsignedReleaseManifest } from "../src/production/types.ts"

const pair = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } })
const unsigned: UnsignedReleaseManifest = { schemaVersion: 1, product: "spectra", version: "1.1.0", channel: "stable", publishedAt: new Date().toISOString(), protocolVersion: 1, minNode: "20", artifacts: [{ name: "spectra.bin", platform: "any", arch: "any", format: "tar.gz", url: "https://updates.invalid/spectra.bin", sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", size: 5 }] }
const signed = signReleaseManifest(unsigned, "test", pair.privateKey)

test("updater accepts only a valid signed manifest", async () => {
  const fetcher = async () => new Response(JSON.stringify(signed), { status: 200, headers: { "content-type": "application/json" } })
  const result = await checkForUpdate("1.0.0", pair.publicKey, "https://updates.invalid/manifest.json", fetcher as typeof fetch)
  assert.equal(result.available, true); assert.equal(result.artifact?.name, "spectra.bin")
})

test("artifact download is atomic, bounded, and checksum verified", async () => {
  const root = await mkdtemp(join(tmpdir(), "spectra-update-"))
  try {
    const fetcher = async () => new Response("hello", { status: 200, headers: { "content-length": "5" } })
    const file = await downloadVerifiedArtifact(unsigned.artifacts[0]!, root, fetcher as typeof fetch)
    assert.equal(await readFile(file, "utf8"), "hello")
    const oversized = async () => new Response("hello!", { status: 200 })
    await assert.rejects(downloadVerifiedArtifact(unsigned.artifacts[0]!, root, oversized as typeof fetch), /exceeded its signed size/)
    await assert.rejects(readFile(join(root, "spectra.bin.partial")))
  } finally { await rm(root, { recursive: true, force: true }) }
})
