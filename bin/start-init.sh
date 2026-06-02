#!/usr/bin/env bash
set -euo pipefail

APT_HOME="${APT_HOME:-$HOME/.apt}"
node "$APT_HOME/arch-engine/dist/cli.js" "$@"
