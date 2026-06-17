#!/usr/bin/env bash
set -euo pipefail
APT_HOME="${APT_HOME:-$HOME/.apt}"
exec node "$APT_HOME/arch-engine/dist/cli-design-sync.js" "$@"
