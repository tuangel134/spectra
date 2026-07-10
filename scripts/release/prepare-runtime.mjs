#!/usr/bin/env node
import { copyFileSync, mkdirSync, chmodSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

const root = resolve(process.argv[2] ?? "desktop-native/runtime")
mkdirSync(root, { recursive: true })
const name = process.platform === "win32" ? "node.exe" : "node"
const destination = join(root, name)
copyFileSync(process.execPath, destination)
try { chmodSync(destination, 0o755) } catch { /* Windows */ }
writeFileSync(join(root, "RUNTIME_VERSION"), `${process.version}\n`)
console.log(`Prepared bundled Node ${process.version}: ${basename(destination)}`)
