import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  discoverFrontendCandidates,
  scanFrontend,
} from "../../src/scanners/frontend.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, "..", "fixtures", "frontend");
const uiPkgDir = path.join(frontendRoot, "packages", "ui");

describe("frontend scanner", () => {
  it("discovers components, utils, and enums with descriptions and exports", async () => {
    const packages = await scanFrontend(frontendRoot);

    expect(packages).toHaveLength(1);

    const ui = packages[0];
    expect(ui.slug).toBe("ui");
    expect(ui.name).toBe("@demo/ui");
    expect(ui.description).toBe("Demo UI component library");
    expect(ui.framework).toBe("react");

    expect(ui.components).toHaveLength(1);
    expect(ui.components[0]).toMatchObject({
      name: "Button",
      file: "src/components/Button.tsx",
      description: "Primary action button for forms and dialogs.",
    });
    expect(ui.components[0]?.exports.some((e) => e.includes("Button"))).toBe(true);

    expect(ui.utils).toHaveLength(1);
    expect(ui.utils[0]).toMatchObject({
      name: "format",
      file: "src/utils/format.ts",
      description: "Format a display label from raw user input.",
    });
    expect(ui.utils[0]?.exports.some((e) => e.includes("formatLabel"))).toBe(true);

    expect(ui.enums).toHaveLength(1);
    expect(ui.enums[0]).toMatchObject({
      name: "OrderStatus",
      file: "src/enums/OrderStatus.ts",
      description: "Order lifecycle states shared across checkout and admin.",
      members: ["Pending", "Paid", "Shipped"],
    });
  });

  it("recursively scans src/** and produces RawCandidate[] via discoverFrontendCandidates", async () => {
    const candidates = await discoverFrontendCandidates(frontendRoot, uiPkgDir, "ui");

    expect(candidates.some((c) => c.kind === "component" && c.name === "Button")).toBe(true);
    expect(candidates.some((c) => c.kind === "util" && c.name === "formatLabel")).toBe(true);
    expect(candidates.some((c) => c.kind === "enum" && c.name === "OrderStatus")).toBe(true);

    const button = candidates.find((c) => c.name === "Button");
    expect(button?.moduleSlug).toBe("ui");
    expect(button?.filePath.replace(/\\/g, "/")).toContain("src/components/Button.tsx");
    expect(button?.javadoc).toContain("Primary action button");
  });
});
