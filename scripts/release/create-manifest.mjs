#!/usr/bin/env node
import { createHash, createPrivateKey, sign } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

const assetsDir = resolve(process.argv[2] ?? "release-assets")
const version = String(process.env.SPECTRA_RELEASE_VERSION ?? process.argv[3] ?? "1.0.0").replace(/^v/, "")
const privateB64 = process.env.SPECTRA_UPDATE_PRIVATE_KEY_B64
if (!privateB64) throw new Error("SPECTRA_UPDATE_PRIVATE_KEY_B64 is required")
const base = `https://github.com/tuangel134/spectra/releases/download/v${version}`
const files = readdirSync(assetsDir).filter((name) => name.startsWith("spectra-desktop-") && !/\.(?:sig|pem|json)$/.test(name) && name !== "SHA256SUMS")
const artifacts = files.map((name) => {
  const lower = name.toLowerCase(); const file = join(assetsDir, name)
  const platform = lower.includes("linux") ? "linux" : lower.includes("windows") ? "win32" : lower.includes("macos") || lower.includes("darwin") ? "darwin" : "any"
  const arch = /arm64|aarch64/.test(lower) ? "arm64" : /x64|x86_64/.test(lower) ? "x64" : "any"
  const format = lower.endsWith(".appimage") ? "appimage" : lower.endsWith(".deb") ? "deb" : lower.endsWith(".msi") ? "msi" : lower.endsWith(".dmg") ? "dmg" : lower.endsWith(".exe") ? "nsis" : lower.includes("pacman") || lower.endsWith(".pkg.tar.zst") ? "pacman" : lower.endsWith(".zip") ? "zip" : "tar.gz"
  return { name: basename(name), platform, arch, format, url: `${base}/${encodeURIComponent(name)}`, sha256: createHash("sha256").update(readFileSync(file)).digest("hex"), size: statSync(file).size, signatureUrl: `${base}/${encodeURIComponent(name)}.sig`, certificateUrl: `${base}/${encodeURIComponent(name)}.pem` }
}).sort((a, b) => a.name.localeCompare(b.name))
const unsigned = { schemaVersion: 1, product: "spectra", version, channel: "stable", publishedAt: new Date().toISOString(), protocolVersion: 1, minNode: "20", notesUrl: `https://github.com/tuangel134/spectra/releases/tag/v${version}`, artifacts, keyId: "spectra-release-1", signature: "" }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])); return value }
const { signature: _signature, ...toSign } = unsigned
const payload = Buffer.from(JSON.stringify(stable(toSign)))
const signature = sign(null, payload, createPrivateKey(Buffer.from(privateB64, "base64").toString("utf8"))).toString("base64")
const manifest = { ...unsigned, signature }
writeFileSync(join(assetsDir, "update-manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
console.log(`Signed update manifest with ${artifacts.length} artifact(s).`)
