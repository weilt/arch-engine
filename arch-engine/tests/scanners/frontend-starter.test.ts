import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  discoverFrontendStarterCandidates,
  isDesignSystemPackage,
  matchesDesignSystemPattern,
} from "../../src/scanners/frontend-starter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const designUiRoot = path.join(__dirname, "..", "fixtures", "frontend", "packages", "design-ui");

describe("frontend starter scanner", () => {
  it("matches designSystemPackages glob patterns", () => {
    expect(matchesDesignSystemPattern("@test/ui", ["@*/ui"])).toBe(true);
    expect(matchesDesignSystemPattern("@org/design-system", ["@org/design-system"])).toBe(
      true
    );
    expect(matchesDesignSystemPattern("@demo/utils", ["@*/ui"])).toBe(false);
  });

  it("detects design system package by heuristic (@scope/ui with >=3 components)", async () => {
    const pkgJson = {
      name: "@test/ui",
      description: "Test design system UI primitives",
    };
    const pkg = {
      slug: "ui",
      name: "@test/ui",
      description: pkgJson.description,
      components: [{ name: "Button" }, { name: "Input" }, { name: "Card" }],
      utils: [],
      enums: [],
    };

    expect(
      isDesignSystemPackage(pkgJson, pkg, [])
    ).toBe(true);
  });

  it("discovers package-level starter candidate with package.json exports and components", async () => {
    const pkg = {
      slug: "ui",
      name: "@test/ui",
      description: "Test design system UI primitives",
      framework: "react" as const,
      components: [
        { name: "Button", file: "src/components/Button.tsx", description: "", exports: [] },
        { name: "Input", file: "src/components/Input.tsx", description: "", exports: [] },
        { name: "Card", file: "src/components/Card.tsx", description: "", exports: [] },
      ],
      utils: [],
      enums: [],
    };

    const candidates = await discoverFrontendStarterCandidates(
      designUiRoot,
      designUiRoot,
      "ui",
      pkg,
      { designSystemPackages: ["@*/ui"] }
    );

    expect(candidates).toHaveLength(1);
    const starter = candidates[0]!;
    expect(starter.kind).toBe("starter");
    expect(starter.name).toBe("@test/ui");
    expect(starter.moduleSlug).toBe("ui");
    expect(starter.javadoc).toContain("design system");

    const exports = starter.signatures.join("\n");
    expect(exports).toContain("main:");
    expect(exports).toContain("types:");
    expect(exports).toContain("exports.");
    expect(exports).toContain("Button");
    expect(exports).toContain("Input");
    expect(exports).toContain("Card");
  });
});
