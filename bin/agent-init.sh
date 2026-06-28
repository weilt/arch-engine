#!/usr/bin/env bash
set -euo pipefail

APT_HOME="${APT_HOME:-$HOME/.apt}"
TARGET="${1:-$(pwd)}"
TARGET="$(cd "$TARGET" && pwd)"

mkdir -p "$TARGET/.ai"
DB="$TARGET/.ai/db.json"
if [ ! -f "$DB" ]; then
  echo '{"contracts":[],"missingRequests":[]}' > "$DB"
fi

mkdir -p "$TARGET/.apt"
mkdir -p "$TARGET/.apt/verify"

STATUS="$TARGET/.apt/status.json"
if [ ! -f "$STATUS" ]; then
  ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"phase":"idle","loopDone":false,"updatedAt":"%s"}\n' "$ISO" > "$STATUS"
fi

APPROVALS="$TARGET/.apt/approvals.json"
if [ ! -f "$APPROVALS" ]; then
  printf '[]\n' > "$APPROVALS"
fi

GOAL="$TARGET/.apt/goal.md"
if [ ! -f "$GOAL" ]; then
  printf '<!-- /apt-goal will overwrite this with the product goal. Do not delete. -->\n' > "$GOAL"
fi

INJECT="$APT_HOME/scripts/inject-platform-assets.cjs"
MCP_ENTRY="$APT_HOME/mcp-server/dist/index.js"
WRITE_MCP="$APT_HOME/scripts/write-project-mcp-json.cjs"
WRITE_CODEX="$APT_HOME/scripts/write-codex-config.cjs"
WRITE_ZCODE="$APT_HOME/scripts/write-zcode-config.cjs"

if [ -f "$INJECT" ]; then
  node "$INJECT" "$TARGET" "$APT_HOME"
else
  echo "WARN: inject-platform-assets.cjs not found, falling back to Claude commands only"
  mkdir -p "$TARGET/.claude/commands"
  for f in "$APT_HOME/templates/"*.md; do
    base="$(basename "$f")"
    case "$base" in
      _*) continue ;;
      *) cp "$f" "$TARGET/.claude/commands/" ;;
    esac
  done
fi

if [ -f "$MCP_ENTRY" ] && [ -f "$WRITE_MCP" ]; then
  node "$WRITE_MCP" "$TARGET" "$MCP_ENTRY"
fi

if [ -f "$MCP_ENTRY" ] && [ -f "$WRITE_CODEX" ]; then
  node "$WRITE_CODEX" "$TARGET" "$MCP_ENTRY"
fi

if [ -f "$MCP_ENTRY" ] && [ -f "$WRITE_ZCODE" ]; then
  node "$WRITE_ZCODE" "$TARGET" "$MCP_ENTRY"
fi

echo "✅ Agent Protocol Toolkit initialized (Claude, Cursor, Qoder, Codex, ZCode)."
