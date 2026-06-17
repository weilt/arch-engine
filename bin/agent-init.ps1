$ErrorActionPreference = "Stop"

$aptHome = if ($env:APT_HOME) { $env:APT_HOME } else { Join-Path $env:USERPROFILE ".apt" }
$target = if ($args.Count -gt 0) { (Resolve-Path $args[0]).Path } else { (Get-Location).Path }

New-Item -ItemType Directory -Force -Path (Join-Path $target ".claude\commands") | Out-Null
Get-ChildItem (Join-Path $aptHome "templates\*.md") | Where-Object { -not $_.Name.StartsWith("_") } | Copy-Item -Destination (Join-Path $target ".claude\commands\") -Force

New-Item -ItemType Directory -Force -Path (Join-Path $target ".ai") | Out-Null
$db = Join-Path $target ".ai\db.json"
if (-not (Test-Path $db)) {
  [System.IO.File]::WriteAllText(
    $db,
    '{"contracts":[],"missingRequests":[]}',
    [System.Text.UTF8Encoding]::new($false)
  )
}

$mcpEntry = Join-Path $aptHome "mcp-server\dist\index.js"
$writeMcp = Join-Path $aptHome "scripts\write-project-mcp-json.js"
if ((Test-Path $mcpEntry) -and (Test-Path $writeMcp)) {
  node $writeMcp $target $mcpEntry
}

Write-Host "✅ Agent Protocol Toolkit initialized. Commands injected."
