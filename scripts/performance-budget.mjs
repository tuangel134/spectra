#!/usr/bin/env node
import { stat } from "node:fs/promises"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const started = performance.now()
await import("../dist/runtime.js")
const importMs = performance.now() - started
const desktopBytes = (await stat(new URL("../dist/web/desktop.js", import.meta.url))).size
const budgets = { importMs: 2500, desktopBytes: 300_000 }
const failures = []
if (importMs > budgets.importMs) failures.push(`runtime import ${Math.round(importMs)}ms > ${budgets.importMs}ms`)
if (desktopBytes > budgets.desktopBytes) failures.push(`desktop bundle ${desktopBytes}B > ${budgets.desktopBytes}B`)
if (failures.length) { console.error(failures.join("\n")); process.exit(1) }
console.log(`Performance budgets passed: runtime ${Math.round(importMs)}ms, desktop ${desktopBytes}B.`)
