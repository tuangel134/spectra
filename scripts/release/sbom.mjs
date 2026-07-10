#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"))
const packages = Object.entries(lock.packages ?? {}).filter(([path]) => path).map(([path, value]) => ({ SPDXID: `SPDXRef-NPM-${path.replace(/[^A-Za-z0-9.-]/g, "-")}`, name: path.split("node_modules/").at(-1), versionInfo: value.version ?? "unknown", downloadLocation: "NOASSERTION", filesAnalyzed: false, licenseConcluded: value.license ?? "NOASSERTION" }))
const cargo = []
if (existsSync(resolve(root, "desktop-native", "Cargo.lock"))) {
  const text = readFileSync(resolve(root, "desktop-native", "Cargo.lock"), "utf8")
  for (const block of text.split("[[package]]").slice(1)) {
    const name = block.match(/\nname = "([^"]+)"/)?.[1]; const version = block.match(/\nversion = "([^"]+)"/)?.[1]
    if (name && version) cargo.push({ SPDXID: `SPDXRef-Cargo-${name}-${version}`.replace(/[^A-Za-z0-9.-]/g, "-"), name, versionInfo: version, downloadLocation: "NOASSERTION", filesAnalyzed: false, licenseConcluded: "NOASSERTION" })
  }
}
const version = lock.packages?.[""]?.version ?? "1.0.0"
const sbom = { spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT", name: `Spectra-${version}`, documentNamespace: `https://github.com/tuangel134/spectra/releases/tag/v${version}/sbom`, creationInfo: { created: new Date().toISOString(), creators: ["Tool: Spectra-SBOM-1.0"] }, packages: [{ SPDXID: "SPDXRef-Spectra", name: "spectra", versionInfo: version, downloadLocation: "https://github.com/tuangel134/spectra", filesAnalyzed: false, licenseConcluded: "MIT" }, ...packages, ...cargo], relationships: [...packages, ...cargo].map((pkg) => ({ spdxElementId: "SPDXRef-Spectra", relationshipType: "DEPENDS_ON", relatedSpdxElement: pkg.SPDXID })) }
const output = process.argv[2] ?? resolve(root, "sbom.spdx.json")
writeFileSync(output, JSON.stringify(sbom, null, 2) + "\n")
console.log(output)
