$ErrorActionPreference = "Stop"
$AptHome = if ($env:APT_HOME) { $env:APT_HOME } else { Join-Path $env:USERPROFILE ".apt" }
$Entry = Join-Path $AptHome "arch-engine\dist\cli-design-sync.js"
& node $Entry @args
