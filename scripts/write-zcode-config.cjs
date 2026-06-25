const fs = require("fs");
const path = require("path");

function mergeAgentProtocolEntry(doc, entryConfig, projectRootAbs) {
  doc.mcpServers = doc.mcpServers || {};
  const prev = doc.mcpServers["agent-protocol-mcp"] || {};
  doc.mcpServers["agent-protocol-mcp"] = {
    ...entryConfig,
    env: {
      ...(prev.env || {}),
      ...(entryConfig.env || {}),
      APT_PROJECT_ROOT: projectRootAbs,
    },
  };
  return doc;
}

function readJsonOrEmpty(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeZcodeConfig(projectRoot, mcpEntry) {
  const rootAbs = path.resolve(projectRoot);
  const entryAbs = path.resolve(mcpEntry);
  const zcodeDir = path.join(rootAbs, ".zcode");
  const configPath = path.join(zcodeDir, "mcp.json");

  fs.mkdirSync(zcodeDir, { recursive: true });
  const doc = mergeAgentProtocolEntry(
    readJsonOrEmpty(configPath),
    {
      type: "stdio",
      command: "node",
      args: [entryAbs],
    },
    rootAbs
  );
  fs.writeFileSync(configPath, JSON.stringify(doc, null, 2) + "\n");
  console.log("OK " + configPath);
  return configPath;
}

function main() {
  const projectRoot = process.argv[2];
  const mcpEntry = process.argv[3];

  if (!projectRoot || !mcpEntry) {
    console.error("Usage: node write-zcode-config.cjs <projectRoot> <mcpEntry>");
    process.exit(1);
  }

  writeZcodeConfig(projectRoot, mcpEntry);
}

if (require.main === module) {
  main();
}

module.exports = { writeZcodeConfig, mergeAgentProtocolEntry };
