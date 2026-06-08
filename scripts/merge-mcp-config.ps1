# Register agent-protocol-mcp globally (all projects). Per-project .mcp.json is written by agent-init.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AptHome = if ($env:APT_HOME) { $env:APT_HOME } else { Join-Path $env:USERPROFILE ".apt" }
$McpEntry = Join-Path $AptHome "mcp-server\dist\index.js"

if (-not (Test-Path $McpEntry)) {
  Write-Error "MCP entry not found: $McpEntry`nRun scripts\install.ps1 first."
  exit 1
}

# Cursor: ~/.cursor/mcp.json (global for Cursor)
$cursorMcp = Join-Path $env:USERPROFILE ".cursor\mcp.json"
$cursorDir = Split-Path $cursorMcp -Parent
if ($cursorDir) {
  New-Item -ItemType Directory -Force -Path $cursorDir | Out-Null
}
node (Join-Path $ScriptDir "merge-mcp-config.js") $cursorMcp $McpEntry "mcpServers" "-"
Write-Host "OK Cursor -> $cursorMcp"

# Claude Code: ~/.claude.json user scope (NOT ~/.claude/settings.json — silently ignored)
$claudeCli = Get-Command claude -ErrorAction SilentlyContinue
if ($claudeCli) {
  & claude mcp remove agent-protocol-mcp -s user 2>&1 | Out-Null
  $removeExit = $LASTEXITCODE
  if ($removeExit -ne 0 -and $removeExit -ne 1) {
    Write-Warning "claude mcp remove returned $removeExit (ignored if server was not registered)"
  }
  & claude mcp add agent-protocol-mcp -s user -- node $McpEntry
  if ($LASTEXITCODE -ne 0) {
    throw "claude mcp add failed (exit $LASTEXITCODE)"
  }
  Write-Host "OK Claude Code (user scope, all projects)"
} else {
  Write-Warning "claude CLI not found. After install, run:"
  Write-Warning "  claude mcp add agent-protocol-mcp -s user -- node $McpEntry"
}

Write-Host ""
Write-Host "agent-protocol-mcp -> $McpEntry"
Write-Host "MCP reads each project's .ai/ via process.cwd() when you run Claude/Cursor in that project."
Write-Host "Per-project: run agent-init in project root (writes .mcp.json + .ai/db.json)."
Write-Host "Note: ~/.claude/settings.json mcpServers is IGNORED by Claude Code."
Write-Host "Restart Cursor / start a new Claude Code session to reload MCP."
