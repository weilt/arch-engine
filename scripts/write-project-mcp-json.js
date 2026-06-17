const fs = require("fs");
const path = require("path");

const projectRoot = process.argv[2];
const entry = process.argv[3];

if (!projectRoot || !entry) {
  console.error("Usage: node write-project-mcp-json.js <projectRoot> <mcpEntry>");
  process.exit(1);
}

const projectRootAbs = path.resolve(projectRoot);

function mergeAgentProtocolEntry(doc, entryConfig) {
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

function writeMcpFile(filePath, entryConfig) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const doc = mergeAgentProtocolEntry(readJsonOrEmpty(filePath), entryConfig);
  fs.writeFileSync(filePath, JSON.stringify(doc, null, 2) + "\n");
  console.log("OK " + filePath);
}

// Claude Code project MCP (.mcp.json)
writeMcpFile(path.join(projectRootAbs, ".mcp.json"), {
  type: "stdio",
  command: "node",
  args: [entry],
});

// Cursor project MCP (.cursor/mcp.json)
writeMcpFile(path.join(projectRootAbs, ".cursor", "mcp.json"), {
  command: "node",
  args: [entry],
});
