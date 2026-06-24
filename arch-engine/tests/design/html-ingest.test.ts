import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractTitle,
  ingestHtmlSource,
  parseHtmlToPageRecipe,
} from "../../src/design/ingest/html.js";
import { queryDesign } from "../../src/design/query.js";
import { runDesignSync } from "../../src/design/sync.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(repoRoot, "tests/fixtures/html-page.html");
const fixtureRel = "tests/fixtures/html-page.html";

describe("html ingest adapter", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "html-ingest-"));
    await fs.mkdir(path.join(tmpRoot, "tests/fixtures"), { recursive: true });
    await fs.copyFile(fixturePath, path.join(tmpRoot, fixtureRel));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("parses title, sections, and data-component attributes", async () => {
    const html = await fs.readFile(fixturePath, "utf-8");
    const warnings: string[] = [];
    const page = parseHtmlToPageRecipe(html, "pages/sample-dashboard.html", warnings);

    expect(extractTitle(html, "fallback")).toBe("Sample Dashboard");
    expect(page.id).toBe("sample-dashboard");
    expect(page.title).toBe("Sample Dashboard");
    expect(page.refPaths).toEqual(["refs/sample-dashboard.html"]);
    expect(page.regions).toEqual([
      { id: "header", components: ["PageHeader"] },
      { id: "main", components: ["Card", "PrimaryButton"] },
      { id: "footer", components: ["SecondaryButton"] },
    ]);
    expect(warnings).toEqual([]);
  });

  it("falls back to h1 when title tag is missing", () => {
    const html = `<html><body><header><h1>Items List</h1></header></body></html>`;
    expect(extractTitle(html, "list-page")).toBe("Items List");
  });

  it("ingestHtmlSource resolves file and ref metadata", async () => {
    const result = await ingestHtmlSource(tmpRoot, fixtureRel);
    expect(result.page.id).toBe("html-page");
    expect(result.refFile.name).toBe("html-page.html");
    expect(result.profile.primarySource.tool).toBe("html");
    expect(result.warnings).toEqual([]);
  });

  it("syncs HTML page to .ai/design/pages and refs", async () => {
    const report = await runDesignSync(tmpRoot, {
      adapter: "html",
      source: fixtureRel,
    });

    expect(report.pagesWritten).toBe(1);
    expect(report.componentsWritten).toBe(0);
    expect(report.profile.primarySource.tool).toBe("html");

    const pageJson = JSON.parse(
      await fs.readFile(path.join(tmpRoot, ".ai/design/pages/html-page.json"), "utf-8")
    );
    expect(pageJson.title).toBe("Sample Dashboard");
    expect(pageJson.regions).toHaveLength(3);

    const refExists = await fs
      .access(path.join(tmpRoot, ".ai/design/refs/html-page.html"))
      .then(() => true)
      .catch(() => false);
    expect(refExists).toBe(true);

    const queried = await queryDesign(tmpRoot, { page: "html-page" });
    expect(queried.kind).toBe("page");
    if (queried.kind === "page") {
      expect(queried.page.refPaths).toContain("refs/html-page.html");
    }
  });

  it("dry-run does not write page or ref files", async () => {
    await runDesignSync(tmpRoot, { adapter: "html", source: fixtureRel, dryRun: true });

    const pageExists = await fs
      .access(path.join(tmpRoot, ".ai/design/pages/html-page.json"))
      .then(() => true)
      .catch(() => false);
    const refExists = await fs
      .access(path.join(tmpRoot, ".ai/design/refs/html-page.html"))
      .then(() => true)
      .catch(() => false);

    expect(pageExists).toBe(false);
    expect(refExists).toBe(false);
  });

  it("parses data-region containers", () => {
    const html = `
      <div data-region="toolbar">
        <span data-component="PrimaryButton"></span>
      </div>
      <div data-region="content">
        <span data-component="Card"></span>
      </div>
    `;
    const page = parseHtmlToPageRecipe(html, "toolbar-page.html");
    expect(page.regions).toEqual([
      { id: "toolbar", components: ["PrimaryButton"] },
      { id: "content", components: ["Card"] },
    ]);
  });
});
