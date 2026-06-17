import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { registerAssetInArch } from "../../src/register-asset.js";
import { refreshAssetInArch } from "../../src/refresh/asset.js";
import type { SummarizeFn } from "../../src/summarize/batch.js";
import { VectorStore } from "../../src/vector/sqlite-store.js";
import { getVectorsDbPath } from "../../src/paths.js";

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

const mockSummarize: SummarizeFn = async () => [
  {
    id: "",
    kind: "util",
    name: "JsonUtils",
    module: "demo",
    path: "demo/src/JsonUtils.java",
    summary: "Refreshed from source via summarize",
    whenToUse: "When parsing JSON from files",
    howToUse: "Call parseObject() static method",
    exports: ["parseObject"],
    related: [],
    tags: ["json", "refresh"],
    source: "summarize",
    updatedAt: new Date().toISOString(),
  },
];

describe("refreshAssetInArch", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "refresh-asset-"));
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

  it("re-summarizes from source and updates md + vectors", async () => {
    await registerAssetInArch(tmpRoot, {
      kind: "util",
      name: "JsonUtils",
      module: "demo",
      sourcePath: "demo/src/JsonUtils.java",
      summary: "Old handwritten summary",
      whenToUse: "old",
      howToUse: "old",
    });

    await fs.writeFile(
      path.join(tmpRoot, "demo", "src", "JsonUtils.java"),
      "public class JsonUtils { public static Object parseObject(String s) { return null; } }",
      "utf-8"
    );

    const result = await refreshAssetInArch(
      tmpRoot,
      { sourcePath: "demo/src/JsonUtils.java" },
      { summarizeFn: mockSummarize }
    );

    expect(result).toMatchObject({
      ok: true,
      id: "backend/demo/util/JsonUtils",
      path: "backend/demo/util",
      action: "updated",
    });

    const md = await fs.readFile(
      path.join(tmpRoot, ".ai", "arch", "backend", "demo", "utils.md"),
      "utf-8"
    );
    expect(md).toContain("Refreshed from source via summarize");
    expect(md).not.toContain("Old handwritten summary");

    const store = new VectorStore(getVectorsDbPath(tmpRoot));
    try {
      const hits = store.search([1, 0.1], 5);
      const hit = hits.find((h) => h.assetId === "backend/demo/util/JsonUtils");
      expect(hit?.sourcePath).toBe("demo/src/JsonUtils.java");
      expect(hit?.summary).toContain("Refreshed from source via summarize");
    } finally {
      store.close();
    }
  });
});
