const fs = require("fs");
const path = require("path");

const projectRoot = process.argv[2];
const entry = process.argv[3];

if (!projectRoot || !entry) {
  console.error("Usage: node write-project-mcp-json.js <projectRoot> <mcpEntry>");
  process.exit(1);
}

const mcpPath = path.join(projectRoot, ".mcp.json");
let doc = {};
if (fs.existsSync(mcpPath)) {
  doc = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
}

doc.mcpServers = doc.mcpServers || {};
const prev = doc.mcpServers["agent-protocol-mcp"] || {};
doc.mcpServers["agent-protocol-mcp"] = {
  type: "stdio",
  command: "node",
  args: [entry],
  ...(prev.env ? { env: prev.env } : {}),
};

fs.writeFileSync(mcpPath, JSON.stringify(doc, null, 2) + "\n");
console.log("OK " + mcpPath);
