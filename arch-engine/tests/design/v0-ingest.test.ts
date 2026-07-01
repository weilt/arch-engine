import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverV0PageSourceDirs,
  ingestV0Source,
  inferPageTypeFromTsx,
  loadV0Manifest,
  readV0Logic,
  readV0Manifest,
} from "../../src/design/ingest/v0.js";
import { queryDesign } from "../../src/design/query.js";
import { runDesignSync } from "../../src/design/sync.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRel = "designs/v0-fixture/user-list";

describe("v0 ingest adapter", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "v0-ingest-"));
    await fs.cp(path.join(repoRoot, "designs/v0-fixture"), path.join(tmpRoot, "designs/v0-fixture"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("validates manifest required fields and pageType enum", () => {
    expect(() => readV0Manifest({})).toThrow(/missing required field/);
    expect(() =>
      readV0Manifest({
        id: "bad",
        pageType: "invalid",
        feature: "f",
        title: "t",
        route: "/",
        description: "d",
      })
    ).toThrow(/pageType must be one of/);
  });

  it("reads manifest and logic from fixture directory", async () => {
    const dir = path.join(tmpRoot, fixtureRel);
    const manifest = await loadV0Manifest(dir);
    expect(manifest.id).toBe("user-list");
    expect(manifest.pageType).toBe("list");
    const logic = await readV0Logic(dir);
    expect(logic).toContain("listUsers");
  });

  it("infers list pageType from Table/DataTable in tsx", () => {
    expect(inferPageTypeFromTsx('<DataTable columns={[]} />')).toBe("list");
    expect(inferPageTypeFromTsx("<form onSubmit={handleSubmit}>")).toBe("form");
  });

  it("ingestV0Source builds recipe with regions and ref paths", async () => {
    const result = await ingestV0Source(tmpRoot, fixtureRel);
    expect(result.page.id).toBe("user-list");
    expect(result.page.pageType).toBe("list");
    expect(result.page.feature).toBe("user-management");
    expect(result.page.logicPath).toBe("logic/user-list.md");
    expect(result.page.refPaths).toEqual(
      expect.arrayContaining(["refs/user-list.tsx", "refs/user-list.html"])
    );
    expect(result.page.regions[0]?.components).toEqual(
      expect.arrayContaining(["PageHeader", "EmptyState", "PrimaryButton"])
    );
    expect(result.warnings).toEqual([]);
  });

  it("throws when manifest is missing", async () => {
    const emptyDir = path.join(tmpRoot, "designs/v0/empty-page");
    await fs.mkdir(emptyDir, { recursive: true });
    await fs.writeFile(path.join(emptyDir, "page.logic.md"), "# logic\n", "utf-8");
    await expect(ingestV0Source(tmpRoot, "designs/v0/empty-page")).rejects.toThrow(
      /page.manifest.json/
    );
  });

  it("throws when logic is missing", async () => {
    const noLogicDir = path.join(tmpRoot, "designs/v0/no-logic");
    await fs.mkdir(noLogicDir, { recursive: true });
    await fs.writeFile(
      path.join(noLogicDir, "page.manifest.json"),
      JSON.stringify({
        id: "no-logic",
        pageType: "list",
        feature: "f",
        title: "No Logic",
        route: "/no-logic",
        description: "d",
        status: "draft",
      }),
      "utf-8"
    );
    await expect(ingestV0Source(tmpRoot, "designs/v0/no-logic")).rejects.toThrow(/page.logic.md/);
  });

  it("warns when tsx pageType conflicts with manifest", async () => {
    const conflictDir = path.join(tmpRoot, "designs/v0/conflict");
    await fs.mkdir(conflictDir, { recursive: true });
    await fs.writeFile(
      path.join(conflictDir, "page.manifest.json"),
      JSON.stringify({
        id: "conflict-page",
        pageType: "detail",
        feature: "f",
        title: "Conflict",
        route: "/c",
        description: "d",
        status: "approved",
      }),
      "utf-8"
    );
    await fs.writeFile(path.join(conflictDir, "page.logic.md"), "# logic\n", "utf-8");
    await fs.writeFile(
      path.join(conflictDir, "page.tsx"),
      "<form onSubmit={() => {}}><input /></form>",
      "utf-8"
    );
    const result = await ingestV0Source(tmpRoot, "designs/v0/conflict");
    expect(result.warnings.some((w) => w.includes("TSX heuristic"))).toBe(true);
    expect(result.page.pageType).toBe("detail");
  });

  it("discovers batch page directories under designs/v0", async () => {
    const batchRoot = path.join(tmpRoot, "designs/v0");
    await fs.mkdir(batchRoot, { recursive: true });
    await fs.cp(path.join(tmpRoot, fixtureRel), path.join(batchRoot, "user-list"), {
      recursive: true,
    });
    const dirs = await discoverV0PageSourceDirs(tmpRoot, "designs/v0");
    expect(dirs).toEqual(["designs/v0/user-list"]);
  });

  it("syncs v0 page to .ai/design pages, logic, and refs", async () => {
    const report = await runDesignSync(tmpRoot, {
      adapter: "v0",
      source: fixtureRel,
    });
    expect(report.pagesWritten).toBe(1);
    expect(report.profile.primarySource.tool).toBe("v0");

    const pageJson = JSON.parse(
      await fs.readFile(path.join(tmpRoot, ".ai/design/pages/user-list.json"), "utf-8")
    );
    expect(pageJson.pageType).toBe("list");
    expect(pageJson.feature).toBe("user-management");

    const logicExists = await fs
      .access(path.join(tmpRoot, ".ai/design/logic/user-list.md"))
      .then(() => true)
      .catch(() => false);
    expect(logicExists).toBe(true);

    const tsxRefExists = await fs
      .access(path.join(tmpRoot, ".ai/design/refs/user-list.tsx"))
      .then(() => true)
      .catch(() => false);
    expect(tsxRefExists).toBe(true);
  });

  it("query_design returns logicMarkdown for synced page", async () => {
    await runDesignSync(tmpRoot, { adapter: "v0", source: fixtureRel });
    const result = await queryDesign(tmpRoot, { page: "user-list" });
    expect(result.kind).toBe("page");
    if (result.kind !== "page") return;
    expect(result.logicMarkdown).toContain("listUsers");
    expect(result.gaps).not.toContain("manifest-not-approved");
    expect(result.gaps).not.toContain("no-implementation-ref");
  });

  it("query_design reports manifest-not-approved for draft status", async () => {
    const draftDir = path.join(tmpRoot, "designs/v0/draft-page");
    await fs.mkdir(draftDir, { recursive: true });
    await fs.writeFile(
      path.join(draftDir, "page.manifest.json"),
      JSON.stringify({
        id: "draft-page",
        pageType: "list",
        feature: "f",
        title: "Draft",
        route: "/draft",
        description: "d",
        status: "draft",
      }),
      "utf-8"
    );
    await fs.writeFile(path.join(draftDir, "page.logic.md"), "# draft\n", "utf-8");
    await fs.writeFile(path.join(draftDir, "page.tsx"), "<table></table>", "utf-8");

    await runDesignSync(tmpRoot, { adapter: "v0", source: "designs/v0/draft-page" });
    const result = await queryDesign(tmpRoot, { page: "draft-page" });
    if (result.kind !== "page") throw new Error("expected page result");
    expect(result.gaps).toContain("manifest-not-approved");
  });
});
