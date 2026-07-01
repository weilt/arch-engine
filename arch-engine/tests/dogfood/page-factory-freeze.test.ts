import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { queryDesign } from "../../src/design/query.js";
import { runDesignSync } from "../../src/design/sync.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePageRel = "designs/v0-fixture/user-list";
const v0SourceRel = "designs/v0";
const checkV0FreezeScript = path.join(repoRoot, "scripts/check-v0-freeze.mjs");

const PAGES_MD = `# v0 页面冻结进度

| page-id | title | handoff | approved | synced | notes |
|---------|-------|---------|----------|--------|-------|
| user-list | 用户列表 | done | yes | no | page-factory dogfood |
`;

async function setupFrozenV0Layout(tmpRoot: string): Promise<void> {
  await fs.mkdir(path.join(tmpRoot, v0SourceRel), { recursive: true });
  await fs.cp(
    path.join(repoRoot, fixturePageRel),
    path.join(tmpRoot, v0SourceRel, "user-list"),
    { recursive: true },
  );
  await fs.writeFile(path.join(tmpRoot, v0SourceRel, "_pages.md"), PAGES_MD, "utf-8");

  const manifestPath = path.join(tmpRoot, v0SourceRel, "user-list", "page.manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  if (manifest.status !== "approved") {
    manifest.status = "approved";
    manifest.reviewedBy = manifest.reviewedBy ?? "dev@example.com";
    manifest.reviewedAt = manifest.reviewedAt ?? new Date().toISOString();
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }
}

describe("page factory freeze dogfood", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "page-factory-freeze-"));
    await setupFrozenV0Layout(tmpRoot);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("frozen v0 layout → design-sync → query_design exposes logicMarkdown without manifest gap", async () => {
    await runDesignSync(tmpRoot, { adapter: "v0", source: v0SourceRel });

    const result = await queryDesign(tmpRoot, { page: "user-list" });
    expect(result.kind).toBe("page");
    if (result.kind !== "page") return;

    expect(result.page.pageType).toBe("list");
    expect(result.page.feature).toBe("user-management");
    expect(result.page.route).toBe("/users");
    expect(result.logicMarkdown).toMatch(/listUsers/);
    expect(result.gaps).not.toContain("manifest-not-approved");
  });

  it("check-v0-freeze passes on fully approved fixture layout", () => {
    execFileSync(process.execPath, [checkV0FreezeScript, tmpRoot], { encoding: "utf8" });
  });
});
