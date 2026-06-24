import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  componentIdFromFigmaName,
  figmaVarNameToTokenKey,
  ingestFigmaSource,
  loadFigmaExport,
  mapFigmaVariablesToTokens,
  parseFigmaExport,
} from "../../src/design/ingest/figma.js";
import { queryDesign } from "../../src/design/query.js";
import { runDesignSync } from "../../src/design/sync.js";
import type { FigmaExport } from "../../src/design/ingest/figma.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(repoRoot, "tests/fixtures/figma-export.json");
const fixtureRel = "tests/fixtures/figma-export.json";

describe("figma ingest adapter", () => {
  let tmpRoot: string;
  let savedToken: string | undefined;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "figma-ingest-"));
    await fs.mkdir(path.join(tmpRoot, "tests/fixtures"), { recursive: true });
    await fs.copyFile(fixturePath, path.join(tmpRoot, fixtureRel));
    savedToken = process.env.FIGMA_ACCESS_TOKEN;
    delete process.env.FIGMA_ACCESS_TOKEN;
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    if (savedToken === undefined) {
      delete process.env.FIGMA_ACCESS_TOKEN;
    } else {
      process.env.FIGMA_ACCESS_TOKEN = savedToken;
    }
  });

  it("normalizes Figma variable names to token keys", () => {
    expect(figmaVarNameToTokenKey("color/primary")).toBe("colorPrimary");
    expect(figmaVarNameToTokenKey("spacing/md")).toBe("spacingMd");
    expect(figmaVarNameToTokenKey("fontFamily/base")).toBe("fontFamilyBase");
  });

  it("maps variables into token buckets with units", () => {
    const warnings: string[] = [];
    const tokens = mapFigmaVariablesToTokens(
      [
        { name: "color/primary", value: "#3366FF", resolvedType: "COLOR" },
        { name: "spacing/md", value: "16", resolvedType: "FLOAT" },
        { name: "radius/sm", value: "4", resolvedType: "FLOAT" },
      ],
      warnings
    );

    expect(tokens.colors?.colorPrimary).toBe("#3366FF");
    expect(tokens.spacing?.spacingMd).toBe("16px");
    expect(tokens.radii?.radiusSm).toBe("4px");
    expect(warnings).toEqual([]);
  });

  it("maps component names to semantic ids with warnings for non-PascalCase", () => {
    const warnings: string[] = [];
    expect(componentIdFromFigmaName("PrimaryButton", warnings)).toBe("PrimaryButton");
    expect(componentIdFromFigmaName("icons/close", warnings)).toBe("Close");
    expect(warnings.some((w) => w.includes("icons/close"))).toBe(true);
  });

  it("parseFigmaExport produces draft tokens and components", async () => {
    const raw = JSON.parse(await fs.readFile(fixturePath, "utf-8")) as FigmaExport;
    const warnings: string[] = [];
    const { tokens, components } = parseFigmaExport(raw, warnings);

    expect(tokens.colors?.colorPrimary).toBe("#3366FF");
    expect(tokens.typography?.fontFamilyBase).toBe("Inter, sans-serif");
    expect(components.map((c) => c.id).sort()).toEqual(["Card", "Close", "PrimaryButton"]);
    expect(components.every((c) => c.constraints?.includes("draft-from-figma"))).toBe(true);
  });

  it("ingestFigmaSource reads JSON fixture without network", async () => {
    const result = await ingestFigmaSource(tmpRoot, fixtureRel);

    expect(result.profile.primarySource.tool).toBe("figma");
    expect(result.components).toHaveLength(3);
    expect(result.warnings.some((w) => w.includes("manual review"))).toBe(true);
    expect(result.refFile?.name).toBe("figma-export.json");
  });

  it("fileKey without FIGMA_ACCESS_TOKEN requires JSON export", async () => {
    await expect(loadFigmaExport(tmpRoot, "AbCdEfGhIjKlMnOpQrSt")).rejects.toThrow(
      /FIGMA_ACCESS_TOKEN/
    );
  });

  it("syncs Figma export to tokens and component drafts", async () => {
    const report = await runDesignSync(tmpRoot, {
      adapter: "figma",
      source: fixtureRel,
    });

    expect(report.componentsWritten).toBe(3);
    expect(report.pagesWritten).toBe(0);
    expect(report.tokenFiles).toContain("colors.json");
    expect(report.tokenFiles).toContain("spacing.json");
    expect(report.profile.primarySource.tool).toBe("figma");

    const colors = JSON.parse(
      await fs.readFile(path.join(tmpRoot, ".ai/design/tokens/colors.json"), "utf-8")
    );
    expect(colors.colorPrimary).toBe("#3366FF");

    const button = JSON.parse(
      await fs.readFile(path.join(tmpRoot, ".ai/design/components/PrimaryButton.json"), "utf-8")
    );
    expect(button.constraints).toContain("draft-from-figma");

    const refExists = await fs
      .access(path.join(tmpRoot, ".ai/design/refs/figma-export.json"))
      .then(() => true)
      .catch(() => false);
    expect(refExists).toBe(true);

    const queried = await queryDesign(tmpRoot, { component: "PrimaryButton" });
    expect(queried.kind).toBe("component");
    if (queried.kind === "component") {
      expect(queried.component.role).toBe("Main call-to-action");
    }
  });

  it("dry-run does not write design artifacts", async () => {
    await runDesignSync(tmpRoot, { adapter: "figma", source: fixtureRel, dryRun: true });

    const designExists = await fs
      .access(path.join(tmpRoot, ".ai/design/profile.json"))
      .then(() => true)
      .catch(() => false);
    expect(designExists).toBe(false);
  });
});
