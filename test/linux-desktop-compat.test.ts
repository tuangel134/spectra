import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const read = (file: string): string => readFileSync(join(root, file), "utf8")

test("Linux native Desktop applies WebKit compatibility before initialization", () => {
  const source = read("desktop-native/src/main.rs")
  const configureAt = source.indexOf("configure_linux_webview();")
  const eventLoopAt = source.indexOf("EventLoop::new()")
  assert.ok(configureAt >= 0)
  assert.ok(eventLoopAt > configureAt)
  assert.match(source, /WEBKIT_DISABLE_DMABUF_RENDERER/)
  assert.match(source, /GDK_BACKEND/)
  assert.match(source, /WINIT_UNIX_BACKEND/)
})

test("Desktop launcher passes the Linux renderer compatibility environment", () => {
  const source = read("src/desktop/launcher.ts")
  assert.match(source, /WEBKIT_DISABLE_DMABUF_RENDERER/)
  assert.match(source, /GDK_BACKEND/)
  assert.match(source, /WINIT_UNIX_BACKEND/)
})

test("git updater rebuilds or invalidates the native Desktop binary", () => {
  const source = read("src/cli/update.ts")
  assert.match(source, /desktop:build/)
  assert.match(source, /rmSync\(nativeBinary/)
})
