import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("frontend scanner (P0-2): source glob coverage", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arch-fe-globs-"));
    await fs.writeFile(
      path.join(tmpRoot, "package.json"),
      JSON.stringify({ name: "js-root-demo", dependencies: { vue: "^3.4.0" } }),
      "utf-8"
    );
    await fs.mkdir(path.join(tmpRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, "src", "format.js"),
      "export function formatJs(value) {\n  return String(value).trim();\n}\n",
      "utf-8"
    );
    await fs.writeFile(
      path.join(tmpRoot, "src", "Bar.jsx"),
      "export function Bar() {\n  return null;\n}\n",
      "utf-8"
    );
    await fs.writeFile(
      path.join(tmpRoot, "src", "Baz.mjs"),
      "export function bazHelper() {\n  return 42;\n}\n",
      "utf-8"
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("collects .js, .jsx, and .mjs files under src/ as utils", async () => {
    const packages = await scanFrontend(tmpRoot);

    expect(packages).toHaveLength(1);
    const pkg = packages[0];
    expect(pkg?.slug).toBe("js-root-demo");

    const utilFiles = pkg?.utils.map((u) => u.file) ?? [];
    expect(utilFiles).toContain("src/format.js");
    expect(utilFiles).toContain("src/Bar.jsx");
    expect(utilFiles).toContain("src/Baz.mjs");
  });

  it("surfaces the same files via discoverFrontendCandidates", async () => {
    const candidates = await discoverFrontendCandidates(tmpRoot, tmpRoot, "js-root-demo");

    expect(candidates.some((c) => c.name === "formatJs")).toBe(true);
    expect(candidates.some((c) => c.name === "bazHelper")).toBe(true);
  });
});

describe("frontend scanner (P2): non-JS-root auto-discovery", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arch-fe-nonjsroot-"));
    // No package.json at the root: this is a non-JS repo root.
    const webDir = path.join(tmpRoot, "web");
    await fs.mkdir(path.join(webDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(webDir, "package.json"),
      JSON.stringify({ name: "@demo/web", dependencies: { vue: "^3.4.0" } }),
      "utf-8"
    );
    await fs.writeFile(
      path.join(webDir, "src", "Page.vue"),
      [
        "<script setup lang=\"ts\">",
        "defineProps<{ title: string }>();",
        "<\/script>",
        "<template><h1>{{ title }}</h1></template>",
        "",
      ].join("\n"),
      "utf-8"
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("discovers a frontend package in a direct child dir", async () => {
    const packages = await scanFrontend(tmpRoot);

    expect(packages).toHaveLength(1);
    const pkg = packages[0];
    expect(pkg?.slug).toBe("web");
    expect(pkg?.name).toBe("@demo/web");
    expect(pkg?.framework).toBe("vue");
    expect(pkg?.components.some((c) => c.name === "Page")).toBe(true);
  });

  it("returns empty and does not throw for a root with no frontend packages", async () => {
    const emptyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arch-fe-empty-"));
    try {
      const packages = await scanFrontend(emptyRoot);
      expect(packages).toEqual([]);
    } finally {
      await fs.rm(emptyRoot, { recursive: true, force: true });
    }
  });
});
