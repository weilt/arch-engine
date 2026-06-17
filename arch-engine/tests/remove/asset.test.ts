import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { removeAssetFromArch } from "../../src/remove/asset.js";
import { registerAssetInArch } from "../../src/register-asset.js";
import { VectorStore } from "../../src/vector/sqlite-store.js";
import { getVectorsDbPath } from "../../src/paths.js";
import { loadArchIndex } from "../../src/writer/arch-index.js";

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

async function setupProject(tmpRoot: string): Promise<void> {
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
}

describe("removeAssetFromArch", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "remove-asset-"));
    await setupProject(tmpRoot);
    process.env.OPENAI_API_KEY = "test";
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(async () => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("removes asset from md, index, and vectors", async () => {
    await registerAssetInArch(tmpRoot, {
      kind: "util",
      name: "JsonUtils",
      module: "demo",
      sourcePath: "demo/src/JsonUtils.java",
      summary: "JSON helpers",
      whenToUse: "When parsing",
      howToUse: "Use parse",
    });

    const result = await removeAssetFromArch(tmpRoot, {
      assetId: "backend/demo/util/JsonUtils",
    });
    expect(result.ok).toBe(true);

    const md = await fs.readFile(
      path.join(tmpRoot, ".ai", "arch", "backend", "demo", "utils.md"),
      "utf-8"
    );
    expect(md).not.toContain("## JsonUtils");

    const index = await loadArchIndex(tmpRoot);
    expect(index.nodes["backend/demo/util"]?.anchors ?? []).not.toContain("JsonUtils");

    const store = new VectorStore(getVectorsDbPath(tmpRoot));
    try {
      const hits = store.search([1, 0.1], 10);
      expect(hits.some((h) => h.assetId === "backend/demo/util/JsonUtils")).toBe(false);
    } finally {
      store.close();
    }
  });
});
