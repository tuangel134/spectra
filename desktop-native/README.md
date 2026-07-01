# Spectra native desktop

A tiny native window (~a few MB) that renders Spectra's web UI in the operating
system's WebView — **no bundled Chromium, no Electron**. This is the "real"
native Spectra Desktop.

## How it fits together

`spectra desktop` (the CLI launcher) does the work:

1. Starts the Spectra engine in-process on a local port.
2. Looks for this compiled binary at `desktop-native/target/release/spectra-desktop`.
   - If found, it opens it as the native window (passing the URL via `SPECTRA_URL`).
   - If not, it falls back to a Chromium-family browser in app mode, then to the
     default browser — so the desktop always works, even unbuilt.

## Build (optional, for the native binary)

Requires the Rust toolchain and the Linux WebView dev libraries:

```bash
# Arch:   sudo pacman -S webkit2gtk-4.1 gtk3 base-devel
# Debian: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev build-essential
npm run desktop:build
```

The resulting binary is picked up automatically the next time you run
`spectra desktop`.
