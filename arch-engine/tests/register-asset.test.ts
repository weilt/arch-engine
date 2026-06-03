import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  inferAssetScope,
  patchArchIndexForAsset,
  registerAssetInArch,
} from "../src/register-asset.js";
import { loadArchIndex } from "../src/writer/arch-index.js";
import { VectorStore } from "../src/vector/sqlite-store.js";
import { getVectorsDbPath } from "../src/paths.js";
import type { AssetCard } from "../src/types.js";
import type { ArchIndex as ArchIndexShape } from "../src/writer/arch-index.js";

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/embeddings")) {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: body.input.map((_, index) => ({
            embedding: [1, 0.1 * (index + 1)],
            index,
          })),
        }),
      };
    }
    throw new Error(`Unexpected fetch URL: ${target}`);
  });
}

describe("inferAssetScope", () => {
  it("prefers existing arch-index module paths", () => {
    const index: ArchIndexShape = {
      root: "root",
      nodes: {
        root: {
          path: "root",
          kind: "root",
          title: "Architecture",
          summary: "",
          children: ["backend", "frontend"],
          chunks: [],
          keywords: [],
        },
        "backend/base-common": {
          path: "backend/base-common",
          kind: "module",
          title: "base-common",
          summary: "",
          children: [],
          chunks: [],
          keywords: [],
        },
      },
    };
    expect(inferAssetScope(index, "base-common", "src/Foo.java", "util")).toBe(
      "backend"
    );
    expect(inferAssetScope(index, "ui", "packages/ui/src/x.ts", "util")).toBe(
      "frontend"
    );
  });
});

describe("patchArchIndexForAsset", () => {
  it("adds kind node and anchor for a new util", () => {
    const index: ArchIndexShape = {
      root: "root",
      nodes: {
        root: {
          path: "root",
          kind: "root",
          title: "Architecture",
          summary: "",
          children: ["backend"],
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
      },
    };
    const card: AssetCard = {
      id: "backend/demo/util/JsonUtils",
      kind: "util",
      name: "JsonUtils",
      module: "demo",
      path: "demo/src/JsonUtils.java",
      summary: "JSON helpers",
      whenToUse: "When parsing JSON",
      howToUse: "Call static methods",
      exports: ["parse"],
      related: [],
      tags: ["json"],
      source: "register",
      updatedAt: "2026-06-02T00:00:00.000Z",
    };
    patchArchIndexForAsset(index, card, "backend");
    expect(index.nodes["backend/demo"]).toBeDefined();
    expect(index.nodes["backend/demo/util"]?.anchors).toContain("JsonUtils");
  });
});

describe("registerAssetInArch", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "register-asset-"));
    await fs.mkdir(path.join(tmpRoot, ".ai", "arch"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, ".ai", "arch", "arch.config.json"),
      JSON.stringify(DEFAULT_CONFIG, null, 2),
      "utf-8"
    );
    await fs.writeFile(
      path.join(tmpRoot, ".ai", "arch", "arch-index.json"),
      JSON.stringify(
        {
          root: "root",
          nodes: {
            root: {
              path: "root",
              kind: "root",
              title: "Architecture",
              summary: "",
              children: ["backend"],
              chunks: [],
              keywords: [],
            },
            backend: {
              path: "backend",
              kind: "module",
              title: "Backend",
              summary: "",
              children: ["backend/demo"],
              chunks: [],
              keywords: [],
            },
            "backend/demo": {
              path: "backend/demo",
              kind: "module",
              title: "demo",
              summary: "",
              children: [],
              chunks: [],
              keywords: [],
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );
    await fs.mkdir(path.join(tmpRoot, "demo", "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, "demo", "src", "JsonUtils.java"),
      "public class JsonUtils {}",
      "utf-8"
    );
    process.env.OPENAI_API_KEY = "test";
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(async () => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("writes md, updates index, and upserts vector", async () => {
    const result = await registerAssetInArch(tmpRoot, {
      kind: "util",
      name: "JsonUtils",
      module: "demo",
      sourcePath: "demo/src/JsonUtils.java",
      summary: "JSON helpers",
      whenToUse: "When parsing JSON",
      howToUse: "Use static parse()",
      exports: ["parse"],
      tags: ["json"],
    });

    expect(result).toEqual({
      ok: true,
      id: "backend/demo/util/JsonUtils",
      path: "backend/demo/util",
    });

    const md = await fs.readFile(
      path.join(tmpRoot, ".ai", "arch", "backend", "demo", "utils.md"),
      "utf-8"
    );
    expect(md).toContain("## JsonUtils");
    expect(md).toContain("JSON helpers");

    const index = await loadArchIndex(tmpRoot);
    expect(index.nodes["backend/demo/util"]?.anchors).toContain("JsonUtils");

    const store = new VectorStore(getVectorsDbPath(tmpRoot));
    try {
      const hits = store.search([1, 0.1], 5);
      expect(hits.some((h) => h.assetId === "backend/demo/util/JsonUtils")).toBe(
        true
      );
      expect(
        hits.find((h) => h.assetId === "backend/demo/util/JsonUtils")?.sourcePath
      ).toBe("demo/src/JsonUtils.java");
    } finally {
      store.close();
    }
  });

  it("rejects missing sourcePath", async () => {
    await expect(
      registerAssetInArch(tmpRoot, {
        kind: "util",
        name: "Missing",
        module: "demo",
        sourcePath: "demo/src/DoesNotExist.java",
        summary: "x",
        whenToUse: "x",
        howToUse: "x",
      })
    ).rejects.toThrow(/Source file not found/);
  });
});
