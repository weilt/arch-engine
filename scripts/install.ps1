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
$dirs = @(
  (Join-Path $AptHome "templates"),
  (Join-Path $AptHome "bin"),
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
Copy-Item -Path (Join-Path $RepoRoot "README.md") -Destination $AptHome -Force

Write-Host "Merging Claude MCP settings..."
$claudeDir = Split-Path $ClaudeSettings -Parent
New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null

node -e "
const fs = require('fs');
const p = process.argv[1];
const entry = process.argv[2];
let s = {};
try {
  s = JSON.parse(fs.readFileSync(p, 'utf8'));
} catch (e) {
  if (e.code === 'ENOENT') {
    s = {};
  } else {
    fs.copyFileSync(p, p + '.bak');
    throw new Error('Invalid settings.json backed up to settings.json.bak');
  }
}
s.mcpServers = s.mcpServers || {};
s.mcpServers['agent-protocol-mcp'] = { command: 'node', args: [entry] };
fs.writeFileSync(p, JSON.stringify(s, null, 2));
" "$ClaudeSettings" "$McpEntry"

$binPath = Join-Path $AptHome "bin"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binPath*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$binPath", "User")
  $env:Path = "$env:Path;$binPath"
}

Write-Host "✅ APT installed to $AptHome"
Write-Host "   Restart your terminal, then run: agent-init; then start-init"
