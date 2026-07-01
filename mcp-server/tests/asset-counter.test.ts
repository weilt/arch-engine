import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listArchModules, listArchPackages } from "../src/ontology/asset-counter.js";

const H2 = "## ";
const H3 = "### ";

// Minimal arch-index.json that loadArchIndex can read. Nodes are keyed like
// `backend/{slug}` and each carries a `title` used as the module/package name.
function writeMinimalIndex(root: string, nodeTitles: Record<string, string>): Promise<void> {
  const nodes: Record<string, unknown> = {
    root: {
      path: "root",
      kind: "root",
      title: "Architecture",
      summary: "",
      children: ["backend", "frontend"],
      chunks: [],
      keywords: [],
    },
    backend: {
      path: "backend",
      kind: "module",
      title: "Backend",
      summary: "",
      children: [],
      chunks: [],
      keywords: [],
    },
    frontend: {
      path: "frontend",
      kind: "package",
      title: "Frontend",
      summary: "",
      children: [],
      chunks: [],
      keywords: [],
    },
  };
  for (const [key, title] of Object.entries(nodeTitles)) {
    const isFrontend = key.startsWith("frontend/");
    nodes[key] = {
      path: key,
      kind: isFrontend ? "package" : "module",
      title,
      summary: "",
      children: [],
      chunks: [],
      keywords: [],
    };
  }
  return fs.writeFile(
    path.join(root, ".ai", "arch", "arch-index.json"),
    JSON.stringify({ root: "root", nodes }, null, 2),
    "utf-8"
  );
}

async function writeFile(parent: string, segments: string[], content: string): Promise<void> {
  const dir = path.join(parent, ...segments.slice(0, -1));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(parent, ...segments), content, "utf-8");
}

describe("asset-counter", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-asset-counter-"));
    await fs.mkdir(path.join(tmpRoot, ".ai", "arch"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  describe("listArchModules", () => {
    it("counts H2 headers per file, maps filename to kind, excludes overview.md", async () => {
      await writeFile(
        tmpRoot,
        [".ai", "arch", "backend", "foo", "utils.md"],
        [H2 + "FooUtil", "body", H2 + "BarUtil", H3 + "NestedNotCounted"].join("\n")
      );
      await writeFile(
        tmpRoot,
        [".ai", "arch", "backend", "foo", "enums.md"],
        [H2 + "StatusEnum"].join("\n")
      );
      await writeFile(
        tmpRoot,
        [".ai", "arch", "backend", "foo", "overview.md"],
        [H2 + "ShouldBeExcluded"].join("\n")
      );
      await writeMinimalIndex(tmpRoot, { "backend/foo": "foo Overview" });

      const modules = await listArchModules(tmpRoot);

      expect(modules).toHaveLength(1);
      const foo = modules[0];
      expect(foo.slug).toBe("foo");
      expect(foo.name).toBe("foo Overview");
      expect(foo.assetCounts.util).toBe(2);
      expect(foo.assetCounts.enum).toBe(1);
      expect(foo.assetCounts.api).toBeUndefined();
      expect(foo.assetCounts.rpc).toBeUndefined();
    });

    it("counts api.md headers as api kind", async () => {
      await writeFile(
        tmpRoot,
        [".ai", "arch", "backend", "bar", "api.md"],
        [H2 + "GET /bar", H2 + "POST /bar", H2 + "DELETE /bar/:id"].join("\n")
      );
      await writeMinimalIndex(tmpRoot, { "backend/bar": "bar Overview" });

      const modules = await listArchModules(tmpRoot);

      expect(modules).toHaveLength(1);
      const bar = modules[0];
      expect(bar.slug).toBe("bar");
      expect(bar.name).toBe("bar Overview");
      expect(bar.assetCounts.api).toBe(3);
    });

    it("falls back to slug when arch-index node is missing", async () => {
      await writeFile(
        tmpRoot,
        [".ai", "arch", "backend", "baz", "pojo.md"],
        [H2 + "BazPojo"].join("\n")
      );
      // No backend/baz entry in the index -> name should fall back to slug.
      await writeMinimalIndex(tmpRoot, {});

      const modules = await listArchModules(tmpRoot);

      const baz = modules.find((m) => m.slug === "baz");
      expect(baz?.name).toBe("baz");
      expect(baz?.assetCounts.pojo).toBe(1);
    });

    it("falls back to slug when arch-index.json is absent", async () => {
      await writeFile(
        tmpRoot,
        [".ai", "arch", "backend", "qux", "utils.md"],
        [H2 + "QuxUtil"].join("\n")
      );
      // No arch-index.json at all -> loadArchIndex throws, name falls back.
      const modules = await listArchModules(tmpRoot);

      const qux = modules.find((m) => m.slug === "qux");
      expect(qux?.name).toBe("qux");
      expect(qux?.assetCounts.util).toBe(1);
    });

    it("returns an empty array when the backend dir is missing", async () => {
      await fs.mkdir(path.join(tmpRoot, ".ai", "arch", "frontend"), { recursive: true });
      const modules = await listArchModules(tmpRoot);
      expect(modules).toEqual([]);
    });

    it("skips unrecognized filenames", async () => {
      await writeFile(
        tmpRoot,
        [".ai", "arch", "backend", "x", "random.md"],
        [H2 + "Ignored"].join("\n")
      );
      await writeMinimalIndex(tmpRoot, {});

      const modules = await listArchModules(tmpRoot);
      expect(modules).toHaveLength(1);
      expect(modules[0].slug).toBe("x");
      expect(modules[0].assetCounts).toEqual({});
    });
  });

  describe("listArchPackages", () => {
    it("counts frontend package assets and leaves framework unset", async () => {
      await writeFile(
        tmpRoot,
        [".ai", "arch", "frontend", "web", "components.md"],
        [H2 + "Header", H2 + "Footer"].join("\n")
      );
      await writeFile(
        tmpRoot,
        [".ai", "arch", "frontend", "web", "routes.md"],
        [H2 + "/home"].join("\n")
      );
      await writeFile(
        tmpRoot,
        [".ai", "arch", "frontend", "web", "stores.md"],
        [H2 + "UserStore", H2 + "CartStore"].join("\n")
      );
      await writeMinimalIndex(tmpRoot, { "frontend/web": "Web Package" });

      const packages = await listArchPackages(tmpRoot);

      expect(packages).toHaveLength(1);
      const web = packages[0];
      expect(web.slug).toBe("web");
      expect(web.name).toBe("Web Package");
      expect(web.framework).toBeUndefined();
      expect(web.assetCounts.component).toBe(2);
      expect(web.assetCounts.route).toBe(1);
      expect(web.assetCounts.store).toBe(2);
    });

    it("returns an empty array when the frontend dir is missing", async () => {
      const packages = await listArchPackages(tmpRoot);
      expect(packages).toEqual([]);
    });
  });
});
