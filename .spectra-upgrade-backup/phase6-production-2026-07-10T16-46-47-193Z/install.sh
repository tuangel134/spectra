#!/usr/bin/env bash
#
# Spectra one-line installer for Linux (any distro) and macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/tuangel134/spectra/main/install.sh | bash
#
# Clones/updates Spectra, builds it, and puts a `spectra` command on your PATH.
# Requires git and Node.js >= 20 (the script checks and tells you if they're missing).

set -euo pipefail

REPO="https://github.com/tuangel134/spectra.git"
DEST="${SPECTRA_HOME:-$HOME/.local/share/spectra}"
BIN_DIR="${SPECTRA_BIN:-$HOME/.local/bin}"

info()  { printf '\033[36m▸\033[0m %s\n' "$1"; }
ok()    { printf '\033[32m✓\033[0m %s\n' "$1"; }
err()   { printf '\033[31m✗\033[0m %s\n' "$1" >&2; }

# --- prerequisites -----------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  err "git is required but was not found. Install git and re-run."
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  err "Node.js >= 20 is required. Install it from https://nodejs.org (or via nvm) and re-run."
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js >= 20 is required (found $(node -v)). Please upgrade and re-run."
  exit 1
fi

# --- fetch / update ----------------------------------------------------------
if [ -d "$DEST/.git" ]; then
  info "Updating existing install at $DEST"
  git -C "$DEST" pull --ff-only --quiet
else
  info "Cloning Spectra into $DEST"
  mkdir -p "$(dirname "$DEST")"
  git clone --depth 1 --quiet "$REPO" "$DEST"
fi

# --- build -------------------------------------------------------------------
info "Installing dependencies and building (this runs 'npm install')"
( cd "$DEST" && npm install --silent )

# --- link the CLI onto PATH --------------------------------------------------
mkdir -p "$BIN_DIR"
ln -sf "$DEST/dist/cli.js" "$BIN_DIR/spectra"
chmod +x "$DEST/dist/cli.js"
ok "Installed the 'spectra' command to $BIN_DIR/spectra"

case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *)
    printf '\n\033[33m!\033[0m %s is not on your PATH. Add this to your shell profile:\n' "$BIN_DIR"
    printf '    export PATH="%s:$PATH"\n' "$BIN_DIR"
    ;;
esac

printf '\n'
ok "Done. Run: spectra"
info "Desktop app: 'spectra desktop' works out of the box (opens a native window or your browser)."
info "For the lightweight native binary, download it from https://github.com/tuangel134/spectra/releases"
