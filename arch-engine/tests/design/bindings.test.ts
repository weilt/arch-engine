import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkFrameworkBindings,
  generateFrameworkBindings,
  listSupportedLibraries,
  readFrameworkBindings,
  resolveComponentBinding,
  resolveLibraryTemplate,
} from "../../src/design/bindings.js";
import { queryDesign } from "../../src/design/query.js";
import { runDesignSync } from "../../src/design/sync.js";

async function writeMinimalDesign(projectRoot: string): Promise<void> {
  const dsDir = path.join(projectRoot, "designs", "bind-ds");
  await fs.mkdir(path.join(dsDir, "components"), { recursive: true });
  await fs.writeFile(path.join(dsDir, "styles.css"), ":root { --colorPrimary: #3366ff; }\n");
  await fs.writeFile(
    path.join(dsDir, "_ds_manifest.json"),
    JSON.stringify({ namespace: "BindDS", components: ["PrimaryButton", "Card"] })
  );
  await fs.writeFile(path.join(dsDir, "_ds_prompt.md"), "Primary blue admin UI.");
  await fs.writeFile(
    path.join(dsDir, "components", "PrimaryButton.prompt.md"),
    "# PrimaryButton\n\nMain CTA.\n"
  );
  await fs.writeFile(path.join(dsDir, "components", "Card.prompt.md"), "# Card\n\nSurface.\n");
  await runDesignSync(projectRoot, { source: "designs/bind-ds" });
}

describe("framework bindings", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "design-bindings-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("lists supported libraries", () => {
    expect(listSupportedLibraries()).toContain("element-plus");
    expect(listSupportedLibraries()).toContain("antd");
    expect(listSupportedLibraries()).toContain("mui");
  });

  it("resolves library aliases", () => {
    const { key } = resolveLibraryTemplate("antdv");
    expect(key).toBe("ant-design-vue");
    const mui = resolveLibraryTemplate("material-ui");
    expect(mui.key).toBe("mui");
  });

  it("rejects framework/library mismatch", async () => {
    await writeMinimalDesign(tmpRoot);
    await expect(
      generateFrameworkBindings(tmpRoot, { framework: "react", library: "element-plus" })
    ).rejects.toThrow(/requires framework "vue"/);
  });

  it("writes element-plus bindings and updates profile preferences", async () => {
    await writeMinimalDesign(tmpRoot);
    const report = await generateFrameworkBindings(tmpRoot, {
      framework: "vue",
      library: "element-plus",
      productType: "admin",
      styleNotes: "light B2B",
    });
    expect(report.library).toBe("element-plus");
    expect(report.componentMappings).toBeGreaterThan(10);

    const bindings = await readFrameworkBindings(tmpRoot);
    expect(bindings?._meta.framework).toBe("vue");
    expect(bindings?._meta.library).toBe("element-plus");
    expect(bindings?._meta.productType).toBe("admin");

    const primary = bindings?.PrimaryButton as { vue?: { component?: string } };
    expect(primary?.vue?.component).toBe("ElButton");

    const profile = JSON.parse(
      await fs.readFile(path.join(tmpRoot, ".ai", "design", "profile.json"), "utf-8")
    );
    expect(profile.preferences.uiLibrary).toBe("element-plus");
    expect(profile.preferences.framework).toBe("vue");
  });

  it("query_design global returns bindings", async () => {
    await writeMinimalDesign(tmpRoot);
    await generateFrameworkBindings(tmpRoot, { framework: "react", library: "antd" });

    const global = await queryDesign(tmpRoot, { scope: "global" });
    expect(global.kind).toBe("global");
    if (global.kind === "global") {
      expect(global.bindings?._meta.library).toBe("antd");
      expect(global.bindings).not.toBeNull();
    }
  });

  it("query_design component returns binding entry", async () => {
    await writeMinimalDesign(tmpRoot);
    await generateFrameworkBindings(tmpRoot, { framework: "react", library: "antd" });

    const result = await queryDesign(tmpRoot, { component: "PrimaryButton" });
    expect(result.kind).toBe("component");
    if (result.kind === "component") {
      expect(result.binding?.react?.component).toBe("Button");
      expect(result.binding?.react?.import).toBe("antd");
    }
  });

  it("query_design component returns null binding without bindings file", async () => {
    await writeMinimalDesign(tmpRoot);
    const result = await queryDesign(tmpRoot, { component: "PrimaryButton" });
    expect(result.kind).toBe("component");
    if (result.kind === "component") {
      expect(result.binding).toBeNull();
    }
  });

  it("resolveComponentBinding returns entry from bindings file", async () => {
    await writeMinimalDesign(tmpRoot);
    await generateFrameworkBindings(tmpRoot, { framework: "vue", library: "element-plus" });
    const bindings = await readFrameworkBindings(tmpRoot);
    const entry = resolveComponentBinding(bindings, "Card");
    expect(entry?.vue?.component).toBe("ElCard");
    expect(resolveComponentBinding(bindings, "Missing")).toBeNull();
  });

  it("writes mui bindings for react", async () => {
    await writeMinimalDesign(tmpRoot);
    const report = await generateFrameworkBindings(tmpRoot, { framework: "react", library: "mui" });
    expect(report.library).toBe("mui");
    const bindings = await readFrameworkBindings(tmpRoot);
    const primary = bindings?.PrimaryButton as { react?: { component?: string; import?: string } };
    expect(primary?.react?.component).toBe("Button");
    expect(primary?.react?.import).toBe("@mui/material");
  });

  it("check reports orphan bindings and missing page bindings", async () => {
    await writeMinimalDesign(tmpRoot);
    await generateFrameworkBindings(tmpRoot, { framework: "react", library: "antd" });

    const pagesDir = path.join(tmpRoot, ".ai", "design", "pages");
    await fs.mkdir(pagesDir, { recursive: true });
    await fs.writeFile(
      path.join(pagesDir, "list-page.json"),
      JSON.stringify({
        id: "list-page",
        title: "List",
        regions: [{ id: "main", components: ["PrimaryButton", "UnknownWidget"] }],
        states: { empty: "EmptyState" },
      })
    );

    const report = await checkFrameworkBindings(tmpRoot);
    expect(report.ok).toBe(false);
    expect(report.warnings.some((w) => w.code === "missing_bindings")).toBe(true);
    const missing = report.warnings.find((w) => w.code === "missing_bindings");
    expect(missing?.ids).toContain("UnknownWidget");
    expect(missing?.ids).not.toContain("EmptyState");
    expect(report.warnings.some((w) => w.code === "orphan_bindings")).toBe(true);
  });

  it("check skips validation when uiLibrary not set", async () => {
    await writeMinimalDesign(tmpRoot);
    const report = await checkFrameworkBindings(tmpRoot);
    expect(report.ok).toBe(true);
    expect(report.warnings[0]?.code).toBe("ui_library_not_set");
  });

  it("dry-run does not write bindings file", async () => {
    await writeMinimalDesign(tmpRoot);
    await generateFrameworkBindings(tmpRoot, {
      framework: "vue",
      library: "element-plus",
      dryRun: true,
    });
    await expect(readFrameworkBindings(tmpRoot)).resolves.toBeNull();
  });
});
