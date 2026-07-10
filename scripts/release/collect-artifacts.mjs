#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { basename, join, resolve } from "node:path"

const [platform, arch, sourceArg, outputArg] = process.argv.slice(2)
if (!platform || !arch || !sourceArg || !outputArg) throw new Error("Usage: collect-artifacts <platform> <arch> <source> <output>")
const source = resolve(sourceArg); const output = resolve(outputArg); mkdirSync(output, { recursive: true })
const allowed = /\.(?:AppImage|deb|dmg|msi|exe|zip|tar\.gz|pkg\.tar\.zst)$/i
const found = []
function walk(dir) { if (!existsSync(dir)) return; for (const name of readdirSync(dir)) { const file = join(dir, name); const stat = statSync(file); if (stat.isDirectory()) walk(file); else if (allowed.test(name)) found.push(file) } }
walk(source)
function packageFormat(file) {
  const lower = basename(file).toLowerCase()
  if (lower.endsWith(".appimage")) return "appimage"
  if (lower.endsWith(".deb")) return "deb"
  if (lower.endsWith(".dmg")) return "dmg"
  if (lower.endsWith(".msi")) return "wix"
  if (lower.endsWith(".exe")) return "nsis"
  if (lower.endsWith(".pkg.tar.zst") || lower.endsWith(".tar.gz")) return "pacman"
  return "package"
}
for (const file of found) {
  const format = packageFormat(file)
  const destination = join(output, `spectra-desktop-${platform}-${arch}-${format}-${basename(file)}`)
  copyFileSync(file, destination)
  console.log(destination)
}
if (!found.length) throw new Error(`No package artifacts found under ${source}`)
