$ErrorActionPreference = "Stop"

$aptHome = if ($env:APT_HOME) { $env:APT_HOME } else { Join-Path $env:USERPROFILE ".apt" }
node (Join-Path $aptHome 'mcp-server\dist\cli-status.js') $args
