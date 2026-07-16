import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const read = (file: string): string => readFileSync(join(root, file), "utf8")

test("Linux Desktop uses Wry's GTK-native constructor", () => {
  const source = read("desktop-native/src/main.rs")
  assert.match(source, /use tao::platform::unix::WindowExtUnix/)
  assert.match(source, /use wry::WebViewBuilderExtUnix/)
  assert.match(source, /WebViewBuilder::new_gtk\(window\.gtk_window\(\)\)/)
})

test("non-Linux Desktop keeps the cross-platform raw-window constructor", () => {
  const source = read("desktop-native/src/main.rs")
  assert.match(source, /#\[cfg\(not\(target_os = "linux"\)\)\][\s\S]*WebViewBuilder::new\(&window\)/)
})

test("Linux renderer safeguards run before the event loop", () => {
  const source = read("desktop-native/src/main.rs")
  const configureAt = source.indexOf("configure_linux_webview();")
  const eventLoopAt = source.indexOf("EventLoop::new()")
  assert.ok(configureAt >= 0)
  assert.ok(eventLoopAt > configureAt)
  assert.match(source, /WEBKIT_DISABLE_DMABUF_RENDERER/)
})

test("upgrade backups are ignored by Git", () => {
  assert.match(read(".gitignore"), /^\.spectra-upgrade-backup\/$/m)
})
