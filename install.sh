#!/usr/bin/env bash
set -euo pipefail
REPO="https://github.com/tuangel134/spectra.git"
DEST="${SPECTRA_HOME:-$HOME/.local/share/spectra}"
BIN_DIR="${SPECTRA_BIN:-$HOME/.local/bin}"
STAGE="${DEST}.stage.$$"
BACKUP="${DEST}.backup.$$"
info(){ printf '\033[36m▸\033[0m %s\n' "$1"; }
ok(){ printf '\033[32m✓\033[0m %s\n' "$1"; }
fail(){ printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }
cleanup(){ rm -rf "$STAGE"; }
trap cleanup EXIT
command -v git >/dev/null 2>&1 || fail "git is required"
command -v node >/dev/null 2>&1 || fail "Node.js >= 20 is required"
[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 20 ] || fail "Node.js >= 20 is required"
rm -rf "$STAGE" "$BACKUP"
info "Downloading a clean Spectra release candidate"
git clone --depth 1 --quiet "$REPO" "$STAGE"
info "Building and validating before replacing the current install"
( cd "$STAGE" && npm ci --silent && npm run build --silent && npm run typecheck --silent && npm test --silent )
if [ -e "$DEST" ]; then mv "$DEST" "$BACKUP"; fi
if ! mv "$STAGE" "$DEST"; then
  [ -e "$BACKUP" ] && mv "$BACKUP" "$DEST"
  fail "Unable to activate the new installation"
fi
if ! { mkdir -p "$BIN_DIR" && ln -sfn "$DEST/dist/cli.js" "$BIN_DIR/spectra" && chmod +x "$DEST/dist/cli.js"; }; then
  rm -rf "$DEST"
  [ -e "$BACKUP" ] && mv "$BACKUP" "$DEST"
  fail "Unable to install the Spectra command; previous installation restored"
fi
rm -rf "$BACKUP"
ok "Spectra 1.0 installed transactionally at $DEST"
case ":$PATH:" in *":$BIN_DIR:"*) : ;; *) printf 'Add to PATH: export PATH="%s:$PATH"\n' "$BIN_DIR";; esac
info "Run: spectra doctor"
