const fs = require("fs");
const path = require("path");

function tomlString(value) {
  return '"' + String(value).replace(/\\/g, "/") + '"';
}

function writeCodexConfig(projectRoot, mcpEntry) {
  const rootAbs = path.resolve(projectRoot);
  const entryAbs = path.resolve(mcpEntry);
  const codexDir = path.join(rootAbs, ".codex");
  const configPath = path.join(codexDir, "config.toml");

  const lines = [
    "[mcp_servers.agent-protocol-mcp]",
    "command = " + tomlString("node"),
    "args = [" + tomlString(entryAbs) + "]",
    "enabled = true",
    "",
    "[mcp_servers.agent-protocol-mcp.env]",
    "APT_PROJECT_ROOT = " + tomlString(rootAbs),
    "",
  ];

  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(configPath, lines.join("\n"));
  console.log("OK " + configPath);
  return configPath;
}

function main() {
  const projectRoot = process.argv[2];
  const mcpEntry = process.argv[3];

  if (!projectRoot || !mcpEntry) {
    console.error("Usage: node write-codex-config.cjs <projectRoot> <mcpEntry>");
    process.exit(1);
  }

  writeCodexConfig(projectRoot, mcpEntry);
}

if (require.main === module) {
  main();
}

module.exports = { writeCodexConfig, tomlString };
