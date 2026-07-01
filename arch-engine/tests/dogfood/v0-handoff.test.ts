import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { queryDesign } from "../../src/design/query.js";
import { runDesignSync } from "../../src/design/sync.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRel = "designs/v0-fixture/user-list";

describe("v0 handoff dogfood", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "v0-handoff-"));
    await fs.cp(path.join(repoRoot, "designs/v0-fixture"), path.join(tmpRoot, "designs/v0-fixture"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("fixture sync → query_design exposes pageType, feature, and logicMarkdown", async () => {
    await runDesignSync(tmpRoot, { adapter: "v0", source: fixtureRel });

    const result = await queryDesign(tmpRoot, { page: "user-list" });
    expect(result.kind).toBe("page");
    if (result.kind !== "page") return;

    expect(result.page.pageType).toBe("list");
    expect(result.page.feature).toBe("user-management");
    expect(result.page.route).toBe("/users");
    expect(result.logicMarkdown).toMatch(/listUsers/);
    expect(result.gaps).not.toContain("manifest-not-approved");
  });

  it("draft manifest surfaces manifest-not-approved gap", async () => {
    const manifestPath = path.join(tmpRoot, fixtureRel, "page.manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    manifest.status = "draft";
    delete manifest.reviewedBy;
    delete manifest.reviewedAt;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    await runDesignSync(tmpRoot, { adapter: "v0", source: fixtureRel });
    const result = await queryDesign(tmpRoot, { page: "user-list" });
    if (result.kind !== "page") throw new Error("expected page");
    expect(result.gaps).toContain("manifest-not-approved");
  });
});
