#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APT_HOME="${APT_HOME:-$HOME/.apt}"
MCP_ENTRY="$APT_HOME/mcp-server/dist/index.js"
SCRIPTS_DIR="$APT_HOME/scripts"

command -v node >/dev/null || { echo "Node.js 18+ required"; exit 1; }

echo "Building arch-engine..."
(cd "$REPO_ROOT/arch-engine" && npm ci && npm run build && npm test)

echo "Building MCP server..."
(cd "$REPO_ROOT/mcp-server" && npm ci && npm run build && npm test)

echo "Deploying to $APT_HOME..."
mkdir -p "$APT_HOME/arch-engine/dist" "$APT_HOME/mcp-server/dist" "$APT_HOME/templates" "$APT_HOME/bin" "$SCRIPTS_DIR"
rm -rf "$APT_HOME/arch-engine/dist"
cp -R "$REPO_ROOT/arch-engine/dist" "$APT_HOME/arch-engine/"
cp "$REPO_ROOT/arch-engine/package.json" "$APT_HOME/arch-engine/"
cp "$REPO_ROOT/arch-engine/package-lock.json" "$APT_HOME/arch-engine/"
(cd "$APT_HOME/arch-engine" && npm ci --omit=dev)
rm -rf "$APT_HOME/mcp-server/dist"
cp -R "$REPO_ROOT/mcp-server/dist" "$APT_HOME/mcp-server/"
cp "$REPO_ROOT/mcp-server/package.json" "$APT_HOME/mcp-server/"
cp "$REPO_ROOT/mcp-server/package-lock.json" "$APT_HOME/mcp-server/"
(cd "$APT_HOME/mcp-server" && npm ci --omit=dev)
cp -R "$REPO_ROOT/templates/." "$APT_HOME/templates/"
cp "$REPO_ROOT/bin/"* "$APT_HOME/bin/"
cp "$REPO_ROOT/scripts/merge-mcp-config.cjs" \
  "$REPO_ROOT/scripts/write-project-mcp-json.cjs" \
  "$REPO_ROOT/scripts/inject-platform-assets.cjs" \
  "$REPO_ROOT/scripts/write-codex-config.cjs" \
  "$SCRIPTS_DIR/"
cp "$REPO_ROOT/README.md" "$APT_HOME/"
chmod +x "$APT_HOME/bin/"*.sh

echo "Registering MCP globally (Claude Code, Cursor, Qoder, Codex)..."
CURSOR_MCP="$HOME/.cursor/mcp.json"
mkdir -p "$(dirname "$CURSOR_MCP")"
node "$SCRIPTS_DIR/merge-mcp-config.cjs" "$CURSOR_MCP" "$MCP_ENTRY" "mcpServers" "-"
echo "OK Cursor -> $CURSOR_MCP"

if command -v claude >/dev/null 2>&1; then
  claude mcp remove agent-protocol-mcp -s user 2>/dev/null || true
  claude mcp add agent-protocol-mcp -s user -- node "$MCP_ENTRY"
  echo "OK Claude Code (user scope, all projects)"
else
  echo "WARN: claude CLI not found. Run: claude mcp add agent-protocol-mcp -s user -- node $MCP_ENTRY"
fi

if command -v qoder >/dev/null 2>&1; then
  qoder mcp remove agent-protocol-mcp -s user 2>/dev/null || true
  if qoder mcp add agent-protocol-mcp -s user -- node "$MCP_ENTRY"; then
    echo "OK Qoder CLI (user scope, all projects)"
  else
    echo "WARN: qoder mcp add failed. Run: qoder mcp add agent-protocol-mcp -s user -- node $MCP_ENTRY"
  fi
else
  echo "WARN: qoder CLI not found. Run: qoder mcp add agent-protocol-mcp -s user -- node $MCP_ENTRY"
fi

if command -v codex >/dev/null 2>&1; then
  codex mcp remove agent-protocol-mcp 2>/dev/null || true
  if codex mcp add agent-protocol-mcp -- node "$MCP_ENTRY"; then
    echo "OK Codex CLI (global)"
  else
    echo "WARN: codex mcp add failed. Run: codex mcp add agent-protocol-mcp -- node $MCP_ENTRY"
  fi
else
  echo "WARN: codex CLI not found. Run: codex mcp add agent-protocol-mcp -- node $MCP_ENTRY"
fi

LINE='export PATH="$HOME/.apt/bin:$PATH"'
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  [ -f "$rc" ] || continue
  grep -q '.apt/bin' "$rc" || echo "$LINE" >> "$rc"
done

echo "✅ APT installed to $APT_HOME"
echo "   Per project: agent-init (then start-init for arch scan)"
