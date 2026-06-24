import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditDesignChanges } from "../../src/design/audit.js";
import { generateFrameworkBindings } from "../../src/design/bindings.js";
import { MissingDesignProfileError } from "../../src/design/errors.js";
import { registerUiPattern } from "../../src/design/implementations.js";
import { runDesignSync } from "../../src/design/sync.js";

async function writeMinimalDesign(projectRoot: string): Promise<void> {
  const dsDir = path.join(projectRoot, "designs", "audit-ds");
  await fs.mkdir(path.join(dsDir, "components"), { recursive: true });
  await fs.writeFile(path.join(dsDir, "styles.css"), ":root { --colorPrimary: #3366ff; }\n");
  await fs.writeFile(
    path.join(dsDir, "_ds_manifest.json"),
    JSON.stringify({
      namespace: "AuditDS",
      components: ["PrimaryButton", "Card", "EmptyState"],
    })
  );
  await fs.writeFile(path.join(dsDir, "_ds_prompt.md"), "Audit fixture design system.");
  await fs.writeFile(
    path.join(dsDir, "components", "PrimaryButton.prompt.md"),
    "# PrimaryButton\n\nMain CTA.\n"
  );
  await fs.writeFile(path.join(dsDir, "components", "Card.prompt.md"), "# Card\n\nSurface.\n");
  await fs.writeFile(
    path.join(dsDir, "components", "EmptyState.prompt.md"),
    "# EmptyState\n\nEmpty list.\n"
  );
  await runDesignSync(projectRoot, { source: "designs/audit-ds" });
}

describe("auditDesignChanges", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "design-audit-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns ok when design knowledge is in sync", async () => {
    await writeMinimalDesign(tmpRoot);

    const result = await auditDesignChanges(tmpRoot);
    expect(result.ok).toBe(true);
    expect(result.stale).toEqual([]);
    expect(result.missing_bindings).toEqual([]);
    expect(result.page_gaps).toEqual([]);
    expect(result.undeclared_implementations).toEqual([]);
    expect(result.token_violations).toEqual([]);
    expect(result.profile.primarySource).toBe("designs/audit-ds");
  });

  it("detects stale when design source is newer than syncedAt", async () => {
    await writeMinimalDesign(tmpRoot);

    const cssPath = path.join(tmpRoot, "designs", "audit-ds", "styles.css");
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(cssPath, future, future);

    const result = await auditDesignChanges(tmpRoot);
    expect(result.ok).toBe(false);
    expect(result.stale).toHaveLength(1);
    expect(result.stale[0]?.sourceRel).toBe("designs/audit-ds");
    expect(result.stale[0]?.syncedAt).toBeTruthy();
    expect(result.stale[0]?.sourceMtimeMs).toBeGreaterThan(Date.parse(result.stale[0]!.syncedAt));
  });

  it("detects missing bindings when uiLibrary is set", async () => {
    await writeMinimalDesign(tmpRoot);
    await generateFrameworkBindings(tmpRoot, { framework: "react", library: "antd" });

    const pagesDir = path.join(tmpRoot, ".ai", "design", "pages");
    await fs.mkdir(pagesDir, { recursive: true });
    await fs.writeFile(
      path.join(pagesDir, "list-page.json"),
      JSON.stringify({
        id: "list-page",
        title: "List",
        regions: [{ id: "main", components: ["PrimaryButton", "GhostWidget"] }],
      })
    );

    const result = await auditDesignChanges(tmpRoot);
    expect(result.ok).toBe(false);
    expect(result.missing_bindings.map((i) => i.componentId)).toContain("GhostWidget");
  });

  it("detects page gaps for unknown components", async () => {
    await writeMinimalDesign(tmpRoot);

    const pagesDir = path.join(tmpRoot, ".ai", "design", "pages");
    await fs.mkdir(pagesDir, { recursive: true });
    await fs.writeFile(
      path.join(pagesDir, "form-page.json"),
      JSON.stringify({
        id: "form-page",
        title: "Form",
        regions: [{ id: "body", components: ["PrimaryButton", "MissingInput"] }],
        states: { empty: "UnknownEmpty" },
      })
    );

    const result = await auditDesignChanges(tmpRoot);
    expect(result.ok).toBe(false);
    expect(result.page_gaps).toEqual([
      {
        page: "form-page",
        unknownComponents: ["MissingInput", "UnknownEmpty"],
      },
    ]);
  });

  it("reports undeclared implementations as warn-level items", async () => {
    await writeMinimalDesign(tmpRoot);

    const pagesDir = path.join(tmpRoot, ".ai", "design", "pages");
    await fs.mkdir(pagesDir, { recursive: true });
    await fs.writeFile(
      path.join(pagesDir, "list-page.json"),
      JSON.stringify({
        id: "list-page",
        title: "List",
        regions: [{ id: "main", components: ["PrimaryButton"] }],
      })
    );
    await registerUiPattern(tmpRoot, {
      page: "list-page",
      sourcePath: "src/pages/ListPage.tsx",
      componentsUsed: ["PrimaryButton"],
    });
    await fs.writeFile(
      path.join(pagesDir, "form-page.json"),
      JSON.stringify({
        id: "form-page",
        title: "Form",
        regions: [{ id: "body", components: ["Card"] }],
      })
    );

    const result = await auditDesignChanges(tmpRoot);
    expect(result.ok).toBe(true);
    expect(result.undeclared_implementations).toEqual([
      { page: "form-page", level: "warn" },
    ]);
  });

  it("scans sourcePaths for token violations when provided", async () => {
    await writeMinimalDesign(tmpRoot);

    const srcDir = path.join(tmpRoot, "src", "components");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, "Widget.tsx"),
      'export const Widget = () => <div style={{ color: "#ff0000", padding: "12px" }} />;\n',
      "utf-8"
    );

    const result = await auditDesignChanges(tmpRoot, { sourcePaths: ["src/components"] });
    expect(result.token_violations.some((v) => v.kind === "hex" && v.match === "#ff0000")).toBe(
      true
    );
    expect(result.token_violations.some((v) => v.kind === "px" && v.match === "12px")).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("throws MissingDesignProfileError when profile is absent", async () => {
    await expect(auditDesignChanges(tmpRoot)).rejects.toThrow(MissingDesignProfileError);
  });
});
