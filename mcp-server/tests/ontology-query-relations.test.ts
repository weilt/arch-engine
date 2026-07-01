import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleQueryOntology } from "../src/ontology-query.js";

// Minimal, real on-disk fixture (no mocks): enough files that aggregateStatus
// does not block (db.json + last-scan.json present) and the asset counter +
// contract reader have something to report. arch-index.json carries a
// backend/foo module node so listArchModules can resolve its title.
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

// A small but valid EntityGraph.relations payload, matching the on-disk shape
// written by arch-engine's writeEntityDocs (JSON.stringify(graph)).
const RELATIONS = [
  { from: "User", to: "Order", kind: "one-to-many", source: "jpa", field: "orders" },
  { from: "OrderItem", to: "Order", kind: "many-to-one", source: "jpa", field: "order" },
];

async function writeFiles(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
  }
}

// The standard snapshot fixture: one backend module (foo, with a single util
// header), one registered contract, a valid arch index, and the two state
// files that keep aggregateStatus out of the blocked phase.
async function writeStandardFixture(root: string): Promise<void> {
  await writeFiles(root, {
    ".ai/arch/backend/foo/utils.md": "## Bar\n\nA util.\n",
    ".ai/db.json": JSON.stringify({
      contracts: [
        {
          name: "BarContract",
          tsFilePath: "x.ts",
          description: "",
          registeredAt: "",
        },
      ],
      missingRequests: [],
    }),
    ".ai/arch/arch-index.json": JSON.stringify(ARCH_INDEX),
    ".ai/arch/last-scan.json": JSON.stringify(LAST_SCAN),
  });
}

describe("query_ontology relations field (v2.0.3)", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "apt-ontology-rel-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("surfaces relations when entities.json holds a non-empty array", async () => {
    await writeStandardFixture(root);
    await writeFiles(root, {
      ".ai/arch/entities.json": JSON.stringify({
        entities: [],
        relations: RELATIONS,
      }),
    });

    const result = await handleQueryOntology(root);
    expect(result).not.toHaveProperty("error");
    const snap = result as {
      relations?: Array<Record<string, unknown>>;
      contracts: unknown[];
      modules: unknown[];
    };

    expect(snap.relations).toBeDefined();
    expect(snap.relations).toEqual(RELATIONS);
    // rest of the snapshot still works
    expect(snap.modules).toHaveLength(1);
    expect(snap.contracts).toHaveLength(1);
  });

  it("omits relations when entities.json is missing", async () => {
    await writeStandardFixture(root);
    // intentionally no entities.json

    const result = await handleQueryOntology(root);
    expect(result).not.toHaveProperty("error");
    const snap = result as {
      relations?: unknown[];
      modules: unknown[];
      contracts: unknown[];
    };

    expect(snap.relations).toBeUndefined();
    // rest of the snapshot still works
    expect(snap.modules).toHaveLength(1);
    expect(snap.contracts).toHaveLength(1);
  });

  it("omits relations when entities.json is corrupt", async () => {
    await writeStandardFixture(root);
    await writeFiles(root, {
      ".ai/arch/entities.json": "{ this is :: not valid JSON }}}",
    });

    const result = await handleQueryOntology(root);
    expect(result).not.toHaveProperty("error");
    const snap = result as {
      relations?: unknown[];
      modules: unknown[];
      contracts: unknown[];
    };

    expect(snap.relations).toBeUndefined();
    // rest of the snapshot still works
    expect(snap.modules).toHaveLength(1);
    expect(snap.contracts).toHaveLength(1);
  });
});
