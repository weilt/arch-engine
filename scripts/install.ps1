$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$AptHome = if ($env:APT_HOME) { $env:APT_HOME } else { Join-Path $env:USERPROFILE ".apt" }
$ClaudeSettings = Join-Path $env:USERPROFILE ".claude\settings.json"
$McpEntry = Join-Path $AptHome "mcp-server\dist\index.js"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js 18+ required"
  exit 1
}

Write-Host "Building arch-engine..."
Push-Location (Join-Path $RepoRoot "arch-engine")
try {
  npm ci
  npm run build
  npm test
} finally {
  Pop-Location
}

Write-Host "Building MCP server..."
Push-Location (Join-Path $RepoRoot "mcp-server")
try {
  npm ci
  npm run build
  npm test
} finally {
  Pop-Location
}

Write-Host "Deploying to $AptHome..."
$archTarget = Join-Path $AptHome "arch-engine"
$mcpTarget = Join-Path $AptHome "mcp-server"
$scriptsTarget = Join-Path $AptHome "scripts"
$dirs = @(
  (Join-Path $AptHome "templates"),
  (Join-Path $AptHome "bin"),
  $scriptsTarget,
  (Join-Path $archTarget "dist"),
  (Join-Path $mcpTarget "dist")
)
foreach ($d in $dirs) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}

Copy-Item -Path (Join-Path $RepoRoot "arch-engine\dist\*") -Destination (Join-Path $archTarget "dist") -Recurse -Force
Copy-Item -Path (Join-Path $RepoRoot "arch-engine\package.json") -Destination $archTarget -Force
Copy-Item -Path (Join-Path $RepoRoot "arch-engine\package-lock.json") -Destination $archTarget -Force
Push-Location $archTarget
try {
  npm ci --omit=dev
} finally {
  Pop-Location
}

Copy-Item -Path (Join-Path $RepoRoot "mcp-server\dist\*") -Destination (Join-Path $mcpTarget "dist") -Recurse -Force
Copy-Item -Path (Join-Path $RepoRoot "mcp-server\package.json") -Destination $mcpTarget -Force
Copy-Item -Path (Join-Path $RepoRoot "mcp-server\package-lock.json") -Destination $mcpTarget -Force
Push-Location $mcpTarget
try {
  npm ci --omit=dev
} finally {
  Pop-Location
}

Copy-Item -Path (Join-Path $RepoRoot "templates\*") -Destination (Join-Path $AptHome "templates") -Force
Copy-Item -Path (Join-Path $RepoRoot "bin\*") -Destination (Join-Path $AptHome "bin") -Force
Copy-Item -Path (Join-Path $RepoRoot "scripts\merge-mcp-config.cjs") -Destination $scriptsTarget -Force
Copy-Item -Path (Join-Path $RepoRoot "scripts\write-project-mcp-json.cjs") -Destination $scriptsTarget -Force
Copy-Item -Path (Join-Path $RepoRoot "README.md") -Destination $AptHome -Force

Write-Host "Registering MCP globally (Claude Code + Cursor)..."
& (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "merge-mcp-config.ps1")

$binPath = Join-Path $AptHome "bin"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binPath*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$binPath", "User")
  $env:Path = "$env:Path;$binPath"
}

Write-Host "✅ APT installed to $AptHome"
Write-Host "   Restart your terminal, then run: agent-init; then start-init"
