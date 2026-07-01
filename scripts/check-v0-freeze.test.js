import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkV0Freeze, parsePagesTable } from "./check-v0-freeze.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(__dirname, "check-v0-freeze.mjs");

function writePagesMd(dir, rows) {
  const header = `| page-id | title | handoff | approved | synced | notes |
|---------|-------|---------|----------|--------|-------|
`;
  const body = rows
    .map(
      (r) =>
        `| ${r.pageId} | ${r.title ?? r.pageId} | done | ${r.approved} | no | |`
    )
    .join("\n");
  const pagesPath = path.join(dir, "designs", "v0", "_pages.md");
  fs.mkdirSync(path.dirname(pagesPath), { recursive: true });
  fs.writeFileSync(pagesPath, header + body + "\n");
  return pagesPath;
}

function writePageFiles(v0Dir, pageId, { manifest = true, logic = true } = {}) {
  const pageDir = path.join(v0Dir, pageId);
  fs.mkdirSync(pageDir, { recursive: true });
  if (manifest) {
    fs.writeFileSync(
      path.join(pageDir, "page.manifest.json"),
      JSON.stringify({ id: pageId }, null, 2)
    );
  }
  if (logic) {
    fs.writeFileSync(path.join(pageDir, "page.logic.md"), `# ${pageId}\n`);
  }
}

describe("parsePagesTable", () => {
  it("parses header and data rows, skips separator", () => {
    const md = `| page-id | title | handoff | approved | synced | notes |
|---------|-------|---------|----------|--------|-------|
| user-list | 用户列表 | pending | yes | no | note |
| settings | 设置 | done | NO | yes | |
`;
    const rows = parsePagesTable(md);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].pageId, "user-list");
    assert.equal(rows[0].approved, "yes");
    assert.equal(rows[1].pageId, "settings");
    assert.equal(rows[1].approved, "NO");
  });

  it("ignores secondary tables like 列说明 in real _pages.md shape", () => {
    const md = `# v0 页面冻结进度

| page-id | title | handoff | approved | synced | notes |
|---------|-------|---------|----------|--------|-------|
| user-list | 用户列表 | pending | no | no | fixture |

**列说明**

| 列 | 含义 |
|----|------|
| \`page-id\` | kebab-case |
| \`approved\` | no | yes |
`;
    const rows = parsePagesTable(md);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pageId, "user-list");
    assert.equal(rows[0].approved, "no");
  });
});

describe("checkV0Freeze", () => {
  /** @type {string} */
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apt-v0-freeze-"));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes when all rows approved and manifest + logic exist", () => {
    const fixture = path.join(tmpDir, "pass");
    const v0Dir = path.join(fixture, "designs", "v0");
    writePagesMd(fixture, [
      { pageId: "user-list", approved: "yes" },
      { pageId: "settings", approved: "YES" },
    ]);
    writePageFiles(v0Dir, "user-list");
    writePageFiles(v0Dir, "settings");

    const result = checkV0Freeze({ repoRoot: fixture });
    assert.equal(result.ok, true);
  });

  it("fails when a row is not approved", () => {
    const fixture = path.join(tmpDir, "not-approved");
    const v0Dir = path.join(fixture, "designs", "v0");
    writePagesMd(fixture, [
      { pageId: "user-list", approved: "yes" },
      { pageId: "settings", approved: "no" },
    ]);
    writePageFiles(v0Dir, "user-list");
    writePageFiles(v0Dir, "settings");

    const result = checkV0Freeze({ repoRoot: fixture });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /settings: approved is "no"/);
  });

  it("fails when page.logic.md is missing", () => {
    const fixture = path.join(tmpDir, "missing-logic");
    const v0Dir = path.join(fixture, "designs", "v0");
    writePagesMd(fixture, [{ pageId: "user-list", approved: "yes" }]);
    writePageFiles(v0Dir, "user-list", { logic: false });

    const result = checkV0Freeze({ repoRoot: fixture });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /missing page\.logic\.md/);
  });

  it("CLI exits 0 on pass and 1 on fail", () => {
    const fixture = path.join(tmpDir, "cli-pass");
    const v0Dir = path.join(fixture, "designs", "v0");
    writePagesMd(fixture, [{ pageId: "user-list", approved: "yes" }]);
    writePageFiles(v0Dir, "user-list");

    execFileSync(process.execPath, [script, fixture], { encoding: "utf8" });

    const failFixture = path.join(tmpDir, "cli-fail");
    writePagesMd(failFixture, [{ pageId: "user-list", approved: "no" }]);
    writePageFiles(path.join(failFixture, "designs", "v0"), "user-list");

    assert.throws(
      () => execFileSync(process.execPath, [script, failFixture]),
      (err) => err.status === 1
    );
  });

  it("CLI handles repo _pages.md shape without crashing", () => {
    const repoRoot = path.resolve(__dirname, "..");
    try {
      execFileSync(process.execPath, [script, repoRoot]);
      assert.fail("expected exit 1");
    } catch (err) {
      assert.equal(err.status, 1);
      assert.match(String(err.stderr), /user-list: approved is "no"/);
    }
  });
});
