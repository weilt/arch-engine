$ErrorActionPreference = "Stop"

$aptHome = if ($env:APT_HOME) { $env:APT_HOME } else { Join-Path $env:USERPROFILE ".apt" }
$target = Get-Location

New-Item -ItemType Directory -Force -Path (Join-Path $target ".claude\commands") | Out-Null
Copy-Item (Join-Path $aptHome "templates\*.md") (Join-Path $target ".claude\commands\") -Force

New-Item -ItemType Directory -Force -Path (Join-Path $target ".ai") | Out-Null
$db = Join-Path $target ".ai\db.json"
if (-not (Test-Path $db)) {
  '{"contracts":[],"missingRequests":[]}' | Set-Content -Path $db -Encoding UTF8
}

Write-Host "✅ Agent Protocol Toolkit initialized. Commands injected."
