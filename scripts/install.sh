#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APT_HOME="${APT_HOME:-$HOME/.apt}"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
MCP_ENTRY="$APT_HOME/mcp-server/dist/index.js"

command -v node >/dev/null || { echo "Node.js 18+ required"; exit 1; }

echo "Building arch-engine..."
(cd "$REPO_ROOT/arch-engine" && npm ci && npm run build && npm test)

echo "Building MCP server..."
(cd "$REPO_ROOT/mcp-server" && npm ci && npm run build && npm test)

echo "Deploying to $APT_HOME..."
mkdir -p "$APT_HOME/arch-engine/dist" "$APT_HOME/mcp-server/dist" "$APT_HOME/templates" "$APT_HOME/bin"
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
cp "$REPO_ROOT/README.md" "$APT_HOME/"
chmod +x "$APT_HOME/bin/agent-init.sh" "$APT_HOME/bin/start-init.sh"

echo "Merging Claude MCP settings..."
mkdir -p "$HOME/.claude"
node -e "
const fs = require('fs');
const p = process.argv[1];
const entry = process.argv[2];
let s = {};
try {
  s = JSON.parse(fs.readFileSync(p, 'utf8'));
} catch (e) {
  if (e.code === 'ENOENT') {
    s = {};
  } else {
    fs.copyFileSync(p, p + '.bak');
    throw new Error('Invalid settings.json backed up to settings.json.bak');
  }
}
s.mcpServers = s.mcpServers || {};
s.mcpServers['agent-protocol-mcp'] = { command: 'node', args: [entry] };
fs.writeFileSync(p, JSON.stringify(s, null, 2));
" "$CLAUDE_SETTINGS" "$MCP_ENTRY"

LINE='export PATH="$HOME/.apt/bin:$PATH"'
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  [ -f "$rc" ] || continue
  grep -q '.apt/bin' "$rc" || echo "$LINE" >> "$rc"
done

echo "✅ APT installed to $APT_HOME"
echo "   Restart your shell, then run: agent-init && start-init"
