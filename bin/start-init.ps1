$ErrorActionPreference = "Stop"

$aptHome = if ($env:APT_HOME) { $env:APT_HOME } else { Join-Path $env:USERPROFILE ".apt" }
node (Join-Path $aptHome "arch-engine/dist/cli.js") @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
