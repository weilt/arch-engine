# Full v2 rescan for E:\chongqing — requires arch.secrets.json with API keys.
# Usage:
#   1. Edit E:\chongqing\.ai\arch\arch.secrets.json (see docs/examples/arch.secrets.example.json)
#   2. powershell -ExecutionPolicy Bypass -File scripts\chongqing-full-scan.ps1

$ErrorActionPreference = "Stop"

$ProjectRoot = if ($env:CHONGQING_ROOT) { $env:CHONGQING_ROOT } else { "E:\chongqing" }
$SecretsPath = Join-Path $ProjectRoot ".ai\arch\arch.secrets.json"
$AptHome = if ($env:APT_HOME) { $env:APT_HOME } else { Join-Path $env:USERPROFILE ".apt" }
$Cli = Join-Path $AptHome "arch-engine\dist\cli.js"

if (-not (Test-Path $Cli)) {
  Write-Error "arch-engine not installed. Run: powershell -File scripts\install.ps1"
}

if (-not (Test-Path $SecretsPath)) {
  $example = Join-Path (Split-Path $PSScriptRoot -Parent) "docs\examples\arch.secrets.example.json"
  if (Test-Path $example) {
    New-Item -ItemType Directory -Force -Path (Split-Path $SecretsPath -Parent) | Out-Null
    Copy-Item $example $SecretsPath
    Write-Host "Created $SecretsPath from example — please add your apiKey values, then re-run this script."
    exit 1
  }
  Write-Error "Missing $SecretsPath — create it with embedding.apiKey and chunking.apiKey"
}

$secrets = Get-Content $SecretsPath -Raw | ConvertFrom-Json
$embedKey = $secrets.embedding.apiKey
$chunkKey = $secrets.chunking.apiKey
if (-not $embedKey -or $embedKey -match "replace-with") {
  Write-Error "Set embedding.apiKey in $SecretsPath"
}
if (-not $chunkKey -or $chunkKey -match "replace-with") {
  Write-Error "Set chunking.apiKey in $SecretsPath"
}

$env:DASHSCOPE_API_KEY = $embedKey
$env:XF_MAAS_API_KEY = $chunkKey

Write-Host "Running start-init --full in $ProjectRoot ..."
Push-Location $ProjectRoot
try {
  node $Cli --full
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Verify:"
Write-Host "  Test-Path $ProjectRoot\.ai\arch\last-scan.json"
Write-Host "  Test-Path $ProjectRoot\.ai\arch\backend\base-common\utils.md"
