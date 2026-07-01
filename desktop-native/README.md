# Spectra native desktop

A tiny native window (~a few MB) that renders Spectra's web UI in the operating
system's WebView — **no bundled Chromium, no Electron**. This is the "real"
native Spectra Desktop.

## How it fits together

`spectra desktop` (the CLI launcher) does the work:

1. Starts the Spectra engine in-process on a local port.
2. Looks for this compiled binary at `desktop-native/target/release/spectra-desktop`
   (`spectra-desktop.exe` on Windows).
   - If found, it opens it as the native window (passing the URL via `SPECTRA_URL`).
   - If not, it falls back to a Chromium-family browser in app mode (Chrome/Edge
     on Windows and macOS, Chromium/Chrome/Brave/Edge on Linux), then to the
     default browser — so the desktop always works, even unbuilt.

The window uses each OS's native WebView via `wry`/`tao`: **WebView2** on Windows,
**WKWebView** on macOS, **WebKitGTK** on Linux. No Chromium is bundled.

## Build (optional, for the native binary)

Requires the [Rust toolchain](https://rustup.rs). Platform prerequisites:

**Linux** — WebKitGTK + GTK dev libraries:
```bash
# Arch:   sudo pacman -S webkit2gtk-4.1 gtk3 base-devel
# Debian: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev build-essential
npm run desktop:build
```

**Windows 10/11** — MSVC build tools + the WebView2 runtime (preinstalled on
Windows 11; on Windows 10 install the "Evergreen" runtime from Microsoft):
```powershell
# Install "Desktop development with C++" via Visual Studio Build Tools, then:
npm run desktop:build
```

**macOS** — Xcode Command Line Tools (`xcode-select --install`), then:
```bash
npm run desktop:build
```

The resulting binary is picked up automatically the next time you run
`spectra desktop`.
