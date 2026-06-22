const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { writeCodexConfig, tomlString } = require("./write-codex-config.cjs");

describe("write-codex-config", () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apt-codex-"));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("tomlString normalizes backslashes", () => {
    assert.equal(tomlString("C:\\Users\\apt"), '"C:/Users/apt"');
  });

  it("writes config.toml with absolute APT_PROJECT_ROOT", () => {
    const entry = path.join(tmpDir, "mcp", "index.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, "// stub");

    const configPath = writeCodexConfig(tmpDir, entry);
    const content = fs.readFileSync(configPath, "utf8");

    assert.match(content, /\[mcp_servers\.agent-protocol-mcp\]/);
    assert.match(content, /command = "node"/);
    assert.match(content, /enabled = true/);
    assert.match(content, /APT_PROJECT_ROOT = "/);

    const rootAbs = path.resolve(tmpDir).replace(/\\/g, "/");
    assert.ok(content.includes(rootAbs));
    const entryAbs = path.resolve(entry).replace(/\\/g, "/");
    assert.ok(content.includes(entryAbs));
  });
});
