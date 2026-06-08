#!/usr/bin/env bash
set -euo pipefail

APT_HOME="${APT_HOME:-$HOME/.apt}"
TARGET="${1:-$(pwd)}"
TARGET="$(cd "$TARGET" && pwd)"

mkdir -p "$TARGET/.claude/commands"
cp "$APT_HOME/templates/"*.md "$TARGET/.claude/commands/"

mkdir -p "$TARGET/.ai"
DB="$TARGET/.ai/db.json"
if [ ! -f "$DB" ]; then
  echo '{"contracts":[],"missingRequests":[]}' > "$DB"
fi

MCP_ENTRY="$APT_HOME/mcp-server/dist/index.js"
WRITE_MCP="$APT_HOME/scripts/write-project-mcp-json.js"
if [ -f "$MCP_ENTRY" ] && [ -f "$WRITE_MCP" ]; then
  node "$WRITE_MCP" "$TARGET" "$MCP_ENTRY"
fi

echo "✅ Agent Protocol Toolkit initialized. Commands injected."
