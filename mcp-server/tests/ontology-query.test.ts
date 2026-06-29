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

describe("handleQueryOntology", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "apt-ontology-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("missing arch-index.json returns project not initialized error", async () => {
    const result = await handleQueryOntology(root);
    expect(result).toEqual({
      error: "project not initialized; run start-init first",
    });
  });

  it("snapshot surfaces modules, contracts, and a status phase", async () => {
    await writeStandardFixture(root);
    const result = await handleQueryOntology(root);

    expect(result).not.toHaveProperty("error");
    const snap = result as {
      modules: { slug: string; assetCounts: { util?: number } }[];
      contracts: { name: string; tsFile: string }[];
      packages: unknown[];
      status: { phase: string };
    };

    expect(snap.modules).toHaveLength(1);
    expect(snap.modules[0]!.slug).toBe("foo");
    expect(snap.modules[0]!.assetCounts.util).toBe(1);

    expect(snap.contracts).toEqual([
      { name: "BarContract", tsFile: "x.ts" },
    ]);
    expect(snap.packages).toEqual([]);
    expect(typeof snap.status.phase).toBe("string");
  });

  it("focus topic matches contracts and reports matchedIn", async () => {
    await writeStandardFixture(root);
    const result = await handleQueryOntology(root, "bar");

    expect(result).not.toHaveProperty("error");
    const focus = result as {
      topic: string;
      matchedIn: string[];
      assets: unknown[];
      contracts: { name: string; tsFile: string }[];
    };

    expect(focus.topic).toBe("bar");
    expect(focus.contracts).toEqual([
      { name: "BarContract", tsFile: "x.ts" },
    ]);
    // handleSearchArch throws without an embedding/vector db -> empty assets,
    // so architecture must not appear in matchedIn.
    expect(focus.assets).toEqual([]);
    expect(focus.matchedIn).toContain("contracts");
    expect(focus.matchedIn).not.toContain("architecture");
  });

  it("missing db.json yields empty contracts without crashing", async () => {
    await writeStandardFixture(root);
    await fs.rm(path.join(root, ".ai", "db.json"));

    const result = await handleQueryOntology(root);
    expect(result).not.toHaveProperty("error");
    const snap = result as { contracts: unknown[] };
    expect(snap.contracts).toEqual([]);
  });

  it("snapshot detects the design layer when tokens/pages exist", async () => {
    await writeStandardFixture(root);
    await writeFiles(root, {
      ".ai/design/tokens/colors.json": "{}",
      ".ai/design/pages/form-page.json": "{}",
    });

    const result = await handleQueryOntology(root);
    const snap = result as {
      design?: {
        hasTokens: boolean;
        hasBindings: boolean;
        pages: string[];
      };
    };
    expect(snap.design).toBeDefined();
    expect(snap.design!.hasTokens).toBe(true);
    expect(snap.design!.hasBindings).toBe(false);
    expect(snap.design!.pages).toContain("form-page");
  });
});
