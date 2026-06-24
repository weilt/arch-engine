import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDesignArchAlignment,
  buildDesignArchAlignmentReport,
  readArchAlignmentReport,
} from "../../src/design/alignment.js";
import { getArchAlignmentPath } from "../../src/design/paths.js";
import type { FrontendPackage } from "../../src/types.js";
import type { FrameworkBindingsFile } from "../../src/design/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const designUiRoot = path.join(__dirname, "..", "fixtures", "frontend", "packages", "design-ui");

const designUiPackage: FrontendPackage = {
  slug: "ui",
  name: "@test/ui",
  description: "Test design system UI primitives",
  framework: "react",
  components: [
    { name: "Button", file: "src/components/Button.tsx", description: "", exports: [] },
    { name: "Input", file: "src/components/Input.tsx", description: "", exports: [] },
    { name: "Card", file: "src/components/Card.tsx", description: "", exports: [] },
  ],
  utils: [],
  enums: [],
};

const antdBindings: FrameworkBindingsFile = {
  _meta: { framework: "react", library: "antd" },
  PrimaryButton: { react: { import: "antd", component: "Button", props: { type: "primary" } } },
  SecondaryButton: { react: { import: "antd", component: "Button" } },
  Card: { react: { import: "antd", component: "Card" } },
  Input: { react: { import: "antd", component: "Input" } },
  Modal: { react: { import: "antd", component: "Modal" } },
};

async function writeDesignProfile(projectRoot: string): Promise<void> {
  const designDir = path.join(projectRoot, ".ai", "design");
  await fs.mkdir(designDir, { recursive: true });
  await fs.writeFile(
    path.join(designDir, "profile.json"),
    JSON.stringify(
      {
        version: 1,
        primarySource: { tool: "baoyu", path: "designs/test-ds" },
        sources: [],
        syncedAt: new Date().toISOString(),
        componentCount: 4,
        pageCount: 0,
        warnings: [],
        preferences: { framework: "react", uiLibrary: "antd" },
      },
      null,
      2
    )
  );
}

describe("design-arch alignment", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "design-alignment-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("maps design-ui components to semantic bindings", () => {
    const report = buildDesignArchAlignmentReport([designUiPackage], antdBindings, {
      designSystemPackages: ["@*/ui"],
    });

    expect(report.uiPackages).toEqual(["@test/ui"]);
    expect(report.suggestions).toHaveLength(3);

    const button = report.suggestions.find((s) => s.archComponent === "Button");
    expect(button?.suggestedSemanticId).toBe("PrimaryButton");
    expect(button?.bindingComponent).toBe("Button");
    expect(button?.confidence).toBe("high");

    const card = report.suggestions.find((s) => s.archComponent === "Card");
    expect(card?.suggestedSemanticId).toBe("Card");
    expect(card?.confidence).toBe("high");

    const input = report.suggestions.find((s) => s.archComponent === "Input");
    expect(input?.suggestedSemanticId).toBe("Input");
    expect(input?.confidence).toBe("high");
  });

  it("writes arch-alignment.json when profile exists", async () => {
    await writeDesignProfile(tmpRoot);
    await fs.writeFile(
      path.join(tmpRoot, ".ai", "design", "framework-bindings.json"),
      JSON.stringify(antdBindings, null, 2)
    );

    const report = await buildDesignArchAlignment(tmpRoot, [designUiPackage], {
      designSystemPackages: ["@*/ui"],
    });

    expect(report.suggestions.length).toBe(3);
    await expect(fs.stat(getArchAlignmentPath(tmpRoot))).resolves.toBeDefined();

    const onDisk = await readArchAlignmentReport(tmpRoot);
    expect(onDisk?.uiPackages).toEqual(["@test/ui"]);
    expect(onDisk?.bindingLibrary).toBe("antd");
  });

  it("ignores non design-system packages", () => {
    const utilsPkg: FrontendPackage = {
      slug: "utils",
      name: "@demo/utils",
      description: "helpers",
      components: [{ name: "formatDate", file: "src/format.ts", description: "", exports: [] }],
      utils: [],
      enums: [],
    };

    const report = buildDesignArchAlignmentReport(
      [designUiPackage, utilsPkg],
      antdBindings
    );

    expect(report.uiPackages).toEqual(["@test/ui"]);
    expect(report.suggestions.every((s) => s.archPackage === "@test/ui")).toBe(true);
  });

  it("reports none confidence when bindings are missing", () => {
    const report = buildDesignArchAlignmentReport([designUiPackage], null);
    expect(report.suggestions[0]?.confidence).toBe("none");
    expect(report.suggestions[0]?.notes).toContain("framework-bindings.json");
  });

  it("fixture design-ui package is detected as design system", async () => {
    const pkgJson = JSON.parse(
      await fs.readFile(path.join(designUiRoot, "package.json"), "utf-8")
    ) as { name: string; description: string };

    const pkg: FrontendPackage = {
      slug: "ui",
      name: pkgJson.name,
      description: pkgJson.description,
      components: designUiPackage.components,
      utils: [],
      enums: [],
    };

    const report = buildDesignArchAlignmentReport([pkg], antdBindings, {
      designSystemPackages: ["@*/ui"],
    });

    expect(report.uiPackages).toContain("@test/ui");
    expect(report.suggestions.map((s) => s.archComponent).sort()).toEqual([
      "Button",
      "Card",
      "Input",
    ]);
  });
});
