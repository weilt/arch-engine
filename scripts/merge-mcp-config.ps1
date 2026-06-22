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
node (Join-Path $ScriptDir "merge-mcp-config.cjs") $cursorMcp $McpEntry "mcpServers" "-"
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

# Qoder CLI: user scope
$qoderCli = Get-Command qoder -ErrorAction SilentlyContinue
if ($qoderCli) {
  & qoder mcp remove agent-protocol-mcp -s user 2>&1 | Out-Null
  $qoderRemoveExit = $LASTEXITCODE
  if ($qoderRemoveExit -ne 0 -and $qoderRemoveExit -ne 1) {
    Write-Warning "qoder mcp remove returned $qoderRemoveExit (ignored if server was not registered)"
  }
  & qoder mcp add agent-protocol-mcp -s user -- node $McpEntry
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "qoder mcp add failed (exit $LASTEXITCODE). Run manually:"
    Write-Warning "  qoder mcp add agent-protocol-mcp -s user -- node $McpEntry"
  } else {
    Write-Host "OK Qoder CLI (user scope, all projects)"
  }
} else {
  Write-Warning "qoder CLI not found. After install, run:"
  Write-Warning "  qoder mcp add agent-protocol-mcp -s user -- node $McpEntry"
}

# Codex CLI: global config
$codexCli = Get-Command codex -ErrorAction SilentlyContinue
if ($codexCli) {
  & codex mcp remove agent-protocol-mcp 2>&1 | Out-Null
  $codexRemoveExit = $LASTEXITCODE
  if ($codexRemoveExit -ne 0 -and $codexRemoveExit -ne 1) {
    Write-Warning "codex mcp remove returned $codexRemoveExit (ignored if server was not registered)"
  }
  & codex mcp add agent-protocol-mcp -- node $McpEntry
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "codex mcp add failed (exit $LASTEXITCODE). Run manually:"
    Write-Warning "  codex mcp add agent-protocol-mcp -- node $McpEntry"
  } else {
    Write-Host "OK Codex CLI (global)"
  }
} else {
  Write-Warning "codex CLI not found. After install, run:"
  Write-Warning "  codex mcp add agent-protocol-mcp -- node $McpEntry"
}

Write-Host ""
Write-Host "agent-protocol-mcp -> $McpEntry"
Write-Host "MCP reads each project's .ai/ via APT_PROJECT_ROOT when set in project config."
Write-Host "Per-project: run agent-init in project root (.mcp.json, .cursor/mcp.json, .codex/config.toml)."
Write-Host "Note: ~/.claude/settings.json mcpServers is IGNORED by Claude Code."
Write-Host "Restart IDE / start a new agent session to reload MCP."
