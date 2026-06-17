const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const script = path.join(__dirname, "write-project-mcp-json.cjs");

describe("write-project-mcp-json", () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apt-mcp-"));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes APT_PROJECT_ROOT to .mcp.json and .cursor/mcp.json", () => {
    const entry = path.join(tmpDir, "fake-mcp", "index.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "// stub");

    execFileSync(process.execPath, [script, tmpDir, entry], {
      encoding: "utf8",
    });

    const claudeMcp = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf8")
    );
    const cursorMcp = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".cursor", "mcp.json"), "utf8")
    );

    const expectedRoot = path.resolve(tmpDir);
    assert.equal(
      claudeMcp.mcpServers["agent-protocol-mcp"].env.APT_PROJECT_ROOT,
      expectedRoot
    );
    assert.equal(
      cursorMcp.mcpServers["agent-protocol-mcp"].env.APT_PROJECT_ROOT,
      expectedRoot
    );
    assert.equal(claudeMcp.mcpServers["agent-protocol-mcp"].type, "stdio");
    assert.equal(claudeMcp.mcpServers["agent-protocol-mcp"].args[0], entry);
  });

  it("preserves other env keys while updating APT_PROJECT_ROOT", () => {
    const entry = path.join(tmpDir, "index.js");
    fs.writeFileSync(entry, "// stub");
    const mcpPath = path.join(tmpDir, ".mcp.json");
    fs.writeFileSync(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          "agent-protocol-mcp": {
            env: { FOO: "bar", APT_PROJECT_ROOT: "/old/path" },
          },
        },
      })
    );

    execFileSync(process.execPath, [script, tmpDir, entry], {
      encoding: "utf8",
    });

    const doc = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    const env = doc.mcpServers["agent-protocol-mcp"].env;
    assert.equal(env.FOO, "bar");
    assert.equal(env.APT_PROJECT_ROOT, path.resolve(tmpDir));
  });
});
