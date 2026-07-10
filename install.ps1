$ErrorActionPreference = "Stop"
$Repo = "https://github.com/tuangel134/spectra.git"
$Dest = if ($env:SPECTRA_HOME) { $env:SPECTRA_HOME } else { Join-Path $env:LOCALAPPDATA "Spectra" }
$BinDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
$Stage = "$Dest.stage.$PID"
$Backup = "$Dest.backup.$PID"
function Info($m) { Write-Host "▸ $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "✓ $m" -ForegroundColor Green }
function Invoke-Checked([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE" }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is required" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js >= 20 is required" }
if ([int](node -p "Number(process.versions.node.split('.')[0])") -lt 20) { throw "Node.js >= 20 is required" }
Remove-Item -Recurse -Force $Stage,$Backup -ErrorAction SilentlyContinue
try {
  Info "Downloading a clean Spectra release candidate"
  Invoke-Checked "git" @("clone", "--depth", "1", "--quiet", $Repo, $Stage)
  Push-Location $Stage
  try {
    Invoke-Checked "npm.cmd" @("ci", "--silent")
    Invoke-Checked "npm.cmd" @("run", "build", "--silent")
    Invoke-Checked "npm.cmd" @("run", "typecheck", "--silent")
    Invoke-Checked "npm.cmd" @("test", "--silent")
  } finally { Pop-Location }
  if (Test-Path $Dest) { Move-Item $Dest $Backup }
  try {
    Move-Item $Stage $Dest
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    $cli = Join-Path $Dest "dist\cli.js"; $shim = Join-Path $BinDir "spectra.cmd"
    "@echo off`r`nnode `"$cli`" %*" | Set-Content -Encoding ASCII $shim
  } catch {
    Remove-Item -Recurse -Force $Dest -ErrorAction SilentlyContinue
    if (Test-Path $Backup) { Move-Item $Backup $Dest }
    throw
  }
  Remove-Item -Recurse -Force $Backup -ErrorAction SilentlyContinue
  Ok "Spectra 1.0 installed transactionally at $Dest"
  Info "Open a new terminal and run: spectra doctor"
} finally { Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue }
