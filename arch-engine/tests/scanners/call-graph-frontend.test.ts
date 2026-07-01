import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanCallGraphFrontend } from "../../src/scanners/call-graph-frontend.js";
import type { FrontendPackage } from "../../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fixtures live under tests/fixtures/call-graph-frontend/src/ so the scanner's
// `src/**` glob finds them, matching the layout of a real frontend package.
const FIXTURE_ROOT = path.join(__dirname, "..", "fixtures", "call-graph-frontend");

const PACKAGE: FrontendPackage = {
  slug: "ui",
  name: "@demo/ui",
  description: "Fixture UI package",
  components: [],
  utils: [],
  enums: [],
};

const PACKAGE_DIRS = new Map<string, string>([["ui", FIXTURE_ROOT]]);

describe("scanCallGraphFrontend", () => {
  it("emits an imports edge for App -> UserCard", async () => {
    const graph = await scanCallGraphFrontend(FIXTURE_ROOT, PACKAGE_DIRS, [PACKAGE]);

    const edge = graph.edges.find(
      (e) =>
        e.from === "component:App" && e.to === "component:UserCard"
    );
    expect(edge).toBeDefined();
    expect(edge?.kind).toBe("imports");
    expect(edge?.confidence).toBe("high");
  });

  it("emits a template edge for App -> UserCard (<UserCard />)", async () => {
    const graph = await scanCallGraphFrontend(FIXTURE_ROOT, PACKAGE_DIRS, [PACKAGE]);

    const edge = graph.edges.find(
      (e) =>
        e.from === "component:App" &&
        e.to === "component:UserCard" &&
        e.kind === "template"
    );
    expect(edge).toBeDefined();
    expect(edge?.confidence).toBe("high");
  });

  it("emits an imports edge for UserCard -> utils", async () => {
    const graph = await scanCallGraphFrontend(FIXTURE_ROOT, PACKAGE_DIRS, [PACKAGE]);

    const edge = graph.edges.find(
      (e) =>
        e.from === "component:UserCard" && e.to === "component:utils"
    );
    expect(edge).toBeDefined();
    expect(edge?.kind).toBe("imports");
  });

  it("builds component nodes with filePath/moduleSlug for resolved files", async () => {
    const graph = await scanCallGraphFrontend(FIXTURE_ROOT, PACKAGE_DIRS, [PACKAGE]);

    const userCard = graph.nodes.find((n) => n.id === "component:UserCard");
    expect(userCard).toBeDefined();
    expect(userCard?.kind).toBe("method");
    expect(userCard?.moduleSlug).toBe("ui");
    expect(userCard?.filePath?.replace(/\\/g, "/")).toContain(
      "src/UserCard.vue"
    );
  });

  it("skips non-relative (bare/alias) imports without error", async () => {
    const graph = await scanCallGraphFrontend(FIXTURE_ROOT, PACKAGE_DIRS, [PACKAGE]);

    // No edge should reference an unresolved bare module like "vue".
    expect(graph.edges.every((e) => !e.to.startsWith("component:vue"))).toBe(true);
    expect(graph.edges.length).toBeGreaterThan(0);
  });
});
