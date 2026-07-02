import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleQueryOntology } from "../src/ontology-query.js";

// Two backend modules, each carrying a repoSlug (multi-repo workspace mode).
const ARCH_INDEX = {
  root: "root",
  nodes: {
    root: {
      path: "root",
      kind: "root",
      title: "Architecture",
      summary: "",
      children: ["backend/users", "backend/orders"],
      chunks: [],
      keywords: [],
    },
    "backend/users": {
      path: "backend/users",
      kind: "module",
      title: "Users",
      summary: "User service",
      repoSlug: "backend-api",
      children: [],
      chunks: [],
      keywords: ["users"],
    },
    "backend/orders": {
      path: "backend/orders",
      kind: "module",
      title: "Orders",
      summary: "Order service",
      repoSlug: "backend-admin",
      children: [],
      chunks: [],
      keywords: ["orders"],
    },
  },
};

const LAST_SCAN = {
  version: 2,
  commit: "nogit",
  branch: "",
  scannedAt: "",
  modules: {},
  packages: {},
};

const WORKSPACE = {
  repos: [
    { path: "backend-api", lang: "java", slug: "backend-api", name: "Backend API" },
    { path: "backend-admin", lang: "java", slug: "backend-admin", name: "Backend Admin" },
  ],
};

async function writeFiles(
  root: string,
  files: Record<string, string>
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
  }
}

// Base multi-repo fixture: 2 modules with repoSlug, a workspace manifest with
// 2 repos, and minimal entity/flow files.
async function writeWorkspaceFixture(root: string): Promise<void> {
  await writeFiles(root, {
    ".ai/arch/backend/users/utils.md": "## UserService\n\nA util.\n",
    ".ai/arch/backend/orders/utils.md": "## OrderService\n\nA util.\n",
    ".ai/db.json": JSON.stringify({ contracts: [], missingRequests: [] }),
    ".ai/arch/arch-index.json": JSON.stringify(ARCH_INDEX),
    ".ai/arch/last-scan.json": JSON.stringify(LAST_SCAN),
    ".ai/arch/entities.json": JSON.stringify({ entities: [], relations: [] }),
    ".ai/arch/flow.json": JSON.stringify({ nodes: [], edges: [] }),
    "apt-workspace.json": JSON.stringify(WORKSPACE),
  });
}

interface Snapshot {
  topology?: { repoCount?: number };
  modules: { slug: string; repoSlug?: string }[];
}

describe("ontology multi-repo workspace", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "apt-ontology-ws-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("surfaces repoCount from apt-workspace.json and repoSlug on modules", async () => {
    await writeWorkspaceFixture(root);
    const result = await handleQueryOntology(root);

    expect(result).not.toHaveProperty("error");
    const snap = result as Snapshot;

    expect(snap.topology?.repoCount).toBe(2);
    expect(snap.modules).toHaveLength(2);

    // Every module carries its repoSlug.
    for (const mod of snap.modules) {
      expect(mod.repoSlug).toBeDefined();
      expect(typeof mod.repoSlug).toBe("string");
    }

    const users = snap.modules.find((m) => m.slug === "users");
    const orders = snap.modules.find((m) => m.slug === "orders");
    expect(users?.repoSlug).toBe("backend-api");
    expect(orders?.repoSlug).toBe("backend-admin");
  });

  it("groups modules by repoSlug so same-repo entries are adjacent", async () => {
    await writeWorkspaceFixture(root);
    const result = await handleQueryOntology(root);
    const snap = result as Snapshot;

    // The two modules belong to different repos, so grouping makes the order
    // deterministic by repoSlug (backend-api < backend-admin).
    const repoSlugs = snap.modules.map((m) => m.repoSlug ?? "");
    const sorted = [...repoSlugs].sort();
    expect(repoSlugs).toEqual(sorted);
  });

  it("falls back to distinct module repoSlugs when no workspace manifest exists", async () => {
    // Same fixture but without apt-workspace.json.
    await writeWorkspaceFixture(root);
    await fs.rm(path.join(root, "apt-workspace.json"));

    const result = await handleQueryOntology(root);
    expect(result).not.toHaveProperty("error");
    const snap = result as Snapshot;

    // 2 distinct repoSlugs across modules -> repoCount is still 2.
    expect(snap.topology?.repoCount).toBe(2);
  });

  it("omits repoCount in single-repo mode (no manifest, no repoSlug)", async () => {
    // arch-index nodes without repoSlug and no workspace manifest.
    await writeFiles(root, {
      ".ai/arch/backend/foo/utils.md": "## Foo\n\nA util.\n",
      ".ai/db.json": JSON.stringify({ contracts: [], missingRequests: [] }),
      ".ai/arch/arch-index.json": JSON.stringify({
        root: "root",
        nodes: {
          root: {
            path: "root",
            kind: "root",
            title: "Architecture",
            summary: "",
            children: ["backend/foo"],
            chunks: [],
            keywords: [],
          },
          "backend/foo": {
            path: "backend/foo",
            kind: "module",
            title: "Foo",
            summary: "",
            children: [],
            chunks: [],
            keywords: ["foo"],
          },
        },
      }),
      ".ai/arch/last-scan.json": JSON.stringify(LAST_SCAN),
    });

    const result = await handleQueryOntology(root);
    const snap = result as Snapshot;
    expect(snap.topology?.repoCount).toBeUndefined();
  });
});
