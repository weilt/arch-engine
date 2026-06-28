#!/usr/bin/env bash
set -euo pipefail

APT_HOME="${APT_HOME:-$HOME/.apt}"
exec node "$APT_HOME/mcp-server/dist/cli-status.js" "$@"
