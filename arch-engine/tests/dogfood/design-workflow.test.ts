import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateFrameworkBindings } from "../../src/design/bindings.js";
import { appendDesignGap, queryDesign } from "../../src/design/query.js";
import { runDesignSync } from "../../src/design/sync.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRel = "designs/apt-reference-ds";

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}

describe("dogfood design workflow (apt-reference-ds)", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "design-dogfood-"));
    await copyDir(path.join(repoRoot, fixtureRel), path.join(tmpRoot, fixtureRel));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("syncs fixture, generates bindings, and answers query_design", async () => {
    const syncReport = await runDesignSync(tmpRoot, { source: fixtureRel });
    expect(syncReport.componentsWritten).toBeGreaterThanOrEqual(8);
    expect(syncReport.pagesWritten).toBe(2);
    expect(syncReport.tokenFiles.length).toBeGreaterThan(0);

    const bindingsReport = await generateFrameworkBindings(tmpRoot, {
      framework: "vue",
      library: "element-plus",
      productType: "admin",
    });
    expect(bindingsReport.library).toBe("element-plus");
    expect(bindingsReport.componentMappings).toBeGreaterThan(0);

    const global = await queryDesign(tmpRoot, { scope: "global" });
    expect(global.kind).toBe("global");
    if (global.kind === "global") {
      expect(global.style).toContain("APT Reference");
      expect(Object.keys(global.tokens).length).toBeGreaterThan(0);
      expect(global.tokens.colors?.colorPrimary).toBe("#2563eb");
      expect(global.tokens.spacing?.spacingMd).toBe("16px");
      expect(global.bindings).not.toBeNull();
      expect(global.bindings?._meta.library).toBe("element-plus");
    }

    const listPage = await queryDesign(tmpRoot, { page: "list-page" });
    expect(listPage.kind).toBe("page");
    if (listPage.kind === "page") {
      expect(listPage.page.id).toBe("list-page");
      expect(listPage.gaps).toEqual([]);
    }

    const formPage = await queryDesign(tmpRoot, { page: "form-page" });
    expect(formPage.kind).toBe("page");
    if (formPage.kind === "page") {
      expect(formPage.page.refPaths).toContain("refs/form-page.html");
      expect(formPage.gaps).toEqual([]);
    }

    await appendDesignGap(tmpRoot, {
      need: "component",
      reason: "dogfood test gap entry",
    });
    const gapsRaw = await fs.readFile(path.join(tmpRoot, ".ai", "design", "gaps.json"), "utf-8");
    const gaps = JSON.parse(gapsRaw) as { reason: string }[];
    expect(gaps.some((g) => g.reason === "dogfood test gap entry")).toBe(true);
  });
});
