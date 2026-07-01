# Spectra one-line installer for Windows 10/11 (PowerShell).
#
#   irm https://raw.githubusercontent.com/tuangel134/spectra/main/install.ps1 | iex
#
# Clones/updates Spectra, builds it, and puts a `spectra` command on your PATH.
# Requires git and Node.js >= 20.

$ErrorActionPreference = "Stop"

$Repo = "https://github.com/tuangel134/spectra.git"
$Dest = if ($env:SPECTRA_HOME) { $env:SPECTRA_HOME } else { Join-Path $env:LOCALAPPDATA "Spectra" }
$BinDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"  # already on PATH

function Info($m) { Write-Host "▸ $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "✓ $m" -ForegroundColor Green }
function Fail($m) { Write-Host "✗ $m" -ForegroundColor Red; exit 1 }

# --- prerequisites ---
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "git is required. Install Git for Windows (https://git-scm.com/download/win) and re-run."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js >= 20 is required. Install it from https://nodejs.org and re-run."
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { Fail "Node.js >= 20 is required (found $(node -v)). Please upgrade and re-run." }

# --- fetch / update ---
if (Test-Path (Join-Path $Dest ".git")) {
  Info "Updating existing install at $Dest"
  git -C $Dest pull --ff-only --quiet
} else {
  Info "Cloning Spectra into $Dest"
  New-Item -ItemType Directory -Force -Path (Split-Path $Dest) | Out-Null
  git clone --depth 1 --quiet $Repo $Dest
}

# --- build ---
Info "Installing dependencies and building (this runs 'npm install')"
Push-Location $Dest
try { npm install --silent } finally { Pop-Location }

# --- shim on PATH ---
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$cli = Join-Path $Dest "dist\cli.js"
$shim = Join-Path $BinDir "spectra.cmd"
"@echo off`r`nnode `"$cli`" %*" | Set-Content -Encoding ASCII $shim
Ok "Installed the 'spectra' command to $shim"

Write-Host ""
Ok "Done. Open a new terminal and run: spectra"
Info "Desktop app: 'spectra desktop' works out of the box (native window or your browser)."
Info "For the lightweight native binary, download it from https://github.com/tuangel134/spectra/releases"
