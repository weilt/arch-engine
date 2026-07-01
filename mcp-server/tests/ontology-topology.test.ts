import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleQueryOntology } from "../src/ontology-query.js";
import type { OntologyTopology } from "../src/ontology/types.js";

const ARCH_INDEX = {
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
      summary: "Backend module Foo",
      children: [],
      chunks: [],
      keywords: ["foo"],
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

async function writeBaseFixture(root: string): Promise<void> {
  await writeFiles(root, {
    ".ai/arch/backend/foo/utils.md": "## Bar\n\nA util.\n",
    ".ai/db.json": JSON.stringify({ contracts: [], missingRequests: [] }),
    ".ai/arch/arch-index.json": JSON.stringify(ARCH_INDEX),
    ".ai/arch/last-scan.json": JSON.stringify(LAST_SCAN),
  });
}

async function topology(root: string): Promise<OntologyTopology | undefined> {
  const result = (await handleQueryOntology(root)) as { topology?: OntologyTopology };
  return result.topology;
}

describe("querySnapshot topology", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "apt-topology-"));
  });
 afterEach(async () => {
   await fs.rm(root, { recursive: true, force: true });
 });

  it("aggregates module/entity/flow/rpc counts from real fixtures", async () => {
    await writeBaseFixture(root);
    await writeFiles(root, {
      ".ai/arch/entities.json": JSON.stringify({
        entities: [
          { name: "User", moduleSlug: "foo" },
          { name: "Order", moduleSlug: "foo" },
          { name: "Audit", moduleSlug: "other" },
        ],
        relations: [],
      }),
      ".ai/arch/flow.json": JSON.stringify({
        nodes: [
          { id: "entity:User", layer: "entity", name: "User", moduleSlug: "foo" },
          { id: "rpc:UserClient", layer: "rpc", name: "UserClient", moduleSlug: "foo" },
          { id: "service:UserService", layer: "service", name: "UserService", moduleSlug: "foo" },
        ],
        edges: [
          { from: "service:UserService", to: "rpc:UserClient", confidence: "high" },
          { from: "rpc:UserClient", to: "service:OrderService", confidence: "high" },
          { from: "entity:User", to: "service:UserService", confidence: "high" },
        ],
      }),
    });
    expect(await topology(root)).toEqual({
      moduleCount: 1,
      rpcEndpoints: 1,
      entityCount: 3,
      flowEdgeCount: 3,
      crossServiceRefs: 2,
    });
  });

  it("returns topology with all zeros when entity/flow files are absent", async () => {
    await writeBaseFixture(root);
    const t = await topology(root);
    expect(t).toBeDefined();
    expect(t).toEqual({
      moduleCount: 1,
      rpcEndpoints: 0,
      entityCount: 0,
      flowEdgeCount: 0,
      crossServiceRefs: 0,
    });
  });

  it("treats a corrupt entities.json as zero entities (not omitted)", async () => {
    await writeBaseFixture(root);
    await writeFiles(root, {
      ".ai/arch/entities.json": "{ this is not valid json",
      ".ai/arch/flow.json": JSON.stringify({
        nodes: [{ id: "rpc:X", layer: "rpc", name: "X" }],
        edges: [{ from: "rpc:X", to: "rpc:Y", confidence: "high" }],
      }),
    });
    expect(await topology(root)).toEqual({
      moduleCount: 1,
      rpcEndpoints: 1,
      entityCount: 0,
      flowEdgeCount: 1,
      crossServiceRefs: 1,
    });
  });

  it("counts crossServiceRefs only for edges touching rpc nodes", async () => {
    await writeBaseFixture(root);
    await writeFiles(root, {
      ".ai/arch/flow.json": JSON.stringify({
        nodes: [
          { id: "rpc:A", layer: "rpc", name: "A" },
          { id: "rpc:B", layer: "rpc", name: "B" },
          { id: "service:S", layer: "service", name: "S" },
          { id: "entity:E", layer: "entity", name: "E" },
        ],
        edges: [
          { from: "service:S", to: "rpc:A", confidence: "high" },
          { from: "rpc:A", to: "service:S", confidence: "low" },
          { from: "entity:E", to: "service:S", confidence: "high" },
          { from: "rpc:B", to: "entity:E", confidence: "high" },
        ],
      }),
    });
    expect(await topology(root)).toEqual({
      moduleCount: 1,
      rpcEndpoints: 2,
      entityCount: 0,
      flowEdgeCount: 4,
      crossServiceRefs: 3,
    });
  });

  it("surfaces a zeroed topology for an initialized-but-empty project", async () => {
    // deriveTopology only returns undefined when it throws outright; with an
    // initialized project every source degrades to zero rather than throwing,
    // so topology is present (zeros) instead of omitted.
    await writeBaseFixture(root);
    const t = await topology(root);
    expect(t).toBeDefined();
    expect(t).toEqual({
      moduleCount: 1,
      rpcEndpoints: 0,
      entityCount: 0,
      flowEdgeCount: 0,
      crossServiceRefs: 0,
    });
  });
});
