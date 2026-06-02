#!/usr/bin/env bash
set -euo pipefail

APT_HOME="${APT_HOME:-$HOME/.apt}"
TARGET="$(pwd)"

mkdir -p "$TARGET/.claude/commands"
cp "$APT_HOME/templates/"*.md "$TARGET/.claude/commands/"

mkdir -p "$TARGET/.ai"
DB="$TARGET/.ai/db.json"
if [ ! -f "$DB" ]; then
  echo '{"contracts":[],"missingRequests":[]}' > "$DB"
fi

echo "✅ Agent Protocol Toolkit initialized. Commands injected."
