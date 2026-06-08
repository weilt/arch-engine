const fs = require("fs");
const path = require("path");

const configPath = process.argv[2];
const entry = process.argv[3];
const rootKey = process.argv[4] === "-" ? "" : process.argv[4] || "";

let doc = {};
try {
  doc = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (e) {
  if (e.code === "ENOENT") {
    doc = {};
  } else {
    fs.copyFileSync(configPath, configPath + ".bak");
    throw new Error("Invalid JSON backed up to " + configPath + ".bak");
  }
}

if (rootKey) {
  doc[rootKey] = doc[rootKey] || {};
} else {
  doc.mcpServers = doc.mcpServers || {};
}
const bucket = rootKey ? doc[rootKey] : doc.mcpServers;

bucket["agent-protocol-mcp"] = {
  command: "node",
  args: [entry],
};

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(doc, null, 2));
console.log("OK " + configPath);
