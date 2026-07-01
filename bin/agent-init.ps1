$ErrorActionPreference = "Stop"

$aptHome = if ($env:APT_HOME) { $env:APT_HOME } else { Join-Path $env:USERPROFILE ".apt" }
$target = if ($args.Count -gt 0) { (Resolve-Path $args[0]).Path } else { (Get-Location).Path }

New-Item -ItemType Directory -Force -Path (Join-Path $target ".ai") | Out-Null
$db = Join-Path $target ".ai\db.json"
if (-not (Test-Path $db)) {
  [System.IO.File]::WriteAllText(
    $db,
    '{"contracts":[],"missingRequests":[]}',
    [System.Text.UTF8Encoding]::new($false)
  )
}

New-Item -ItemType Directory -Force -Path (Join-Path $target ".apt") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $target ".apt\verify") | Out-Null

$statusPath = Join-Path $target ".apt\status.json"
if (-not (Test-Path $statusPath)) {
  $iso = (Get-Date).ToUniversalTime().ToString("o")
  [System.IO.File]::WriteAllText(
    $statusPath,
    "{""phase"":""idle"",""loopDone"":false,""updatedAt"":""$iso""}",
    [System.Text.UTF8Encoding]::new($false)
  )
}

$approvalsPath = Join-Path $target ".apt\approvals.json"
if (-not (Test-Path $approvalsPath)) {
  [System.IO.File]::WriteAllText(
    $approvalsPath,
    '[]',
    [System.Text.UTF8Encoding]::new($false)
  )
}

$goalPath = Join-Path $target ".apt\goal.md"
if (-not (Test-Path $goalPath)) {
  [System.IO.File]::WriteAllText(
    $goalPath,
    '<!-- /apt-goal will overwrite this with the product goal. Do not delete. -->' + "`n",
    [System.Text.UTF8Encoding]::new($false)
  )
}

$inject = Join-Path $aptHome "scripts\inject-platform-assets.cjs"
$mcpEntry = Join-Path $aptHome "mcp-server\dist\index.js"
$writeMcp = Join-Path $aptHome "scripts\write-project-mcp-json.cjs"
$writeCodex = Join-Path $aptHome "scripts\write-codex-config.cjs"
$writeZcode = Join-Path $aptHome "scripts\write-zcode-config.cjs"

if (Test-Path $inject) {
  node $inject $target $aptHome
} else {
  Write-Warning "inject-platform-assets.cjs not found; copying Claude commands only"
  New-Item -ItemType Directory -Force -Path (Join-Path $target ".claude\commands") | Out-Null
  Get-ChildItem (Join-Path $aptHome "templates\*.md") | Where-Object { -not $_.Name.StartsWith("_") } | Copy-Item -Destination (Join-Path $target ".claude\commands\") -Force
}

if ((Test-Path $mcpEntry) -and (Test-Path $writeMcp)) {
  node $writeMcp $target $mcpEntry
}

if ((Test-Path $mcpEntry) -and (Test-Path $writeCodex)) {
  node $writeCodex $target $mcpEntry
}

if ((Test-Path $mcpEntry) -and (Test-Path $writeZcode)) {
  node $writeZcode $target $mcpEntry
}

Write-Host "✅ Agent Protocol Toolkit initialized (Claude, Cursor, Qoder, Codex, ZCode)."
