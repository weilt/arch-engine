const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { writeZcodeConfig } = require("./write-zcode-config.cjs");

describe("write-zcode-config", () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apt-zcode-"));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes mcp.json with absolute APT_PROJECT_ROOT and entry path", () => {
    const entry = path.join(tmpDir, "mcp", "index.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "// stub");

    const configPath = writeZcodeConfig(tmpDir, entry);
    const doc = JSON.parse(fs.readFileSync(configPath, "utf8"));

    const server = doc.mcpServers["agent-protocol-mcp"];
    assert.equal(server.type, "stdio");
    assert.equal(server.command, "node");
    assert.equal(server.args[0], path.resolve(entry));
    assert.equal(server.env.APT_PROJECT_ROOT, path.resolve(tmpDir));
  });

  it("preserves other env keys while updating APT_PROJECT_ROOT", () => {
    const entry = path.join(tmpDir, "index.js");
    fs.writeFileSync(entry, "// stub");
    const configPath = path.join(tmpDir, ".zcode", "mcp.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          "agent-protocol-mcp": {
            env: { FOO: "bar", APT_PROJECT_ROOT: "/old/path" },
          },
        },
      })
    );

    writeZcodeConfig(tmpDir, entry);

    const doc = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const env = doc.mcpServers["agent-protocol-mcp"].env;
    assert.equal(env.FOO, "bar");
    assert.equal(env.APT_PROJECT_ROOT, path.resolve(tmpDir));
  });
});
