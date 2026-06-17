import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditArchChanges } from "../../src/audit/changes.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { writeLastScan } from "../../src/incremental/last-scan.js";
import { registerAssetInArch } from "../../src/register-asset.js";
import { runSyncChanges } from "../../src/sync/run.js";
import { VectorStore } from "../../src/vector/sqlite-store.js";
import { getVectorsDbPath } from "../../src/paths.js";
import type { LastScanState } from "../../src/types.js";
import type { SummarizeFn } from "../../src/summarize/batch.js";

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
    summary: "Synced summary",
    whenToUse: "sync",
    howToUse: "sync",
    exports: [],
    related: [],
    tags: [],
    source: "summarize",
    updatedAt: new Date().toISOString(),
  },
];

describe("runSyncChanges", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sync-run-"));
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

  it("dry-run does not change vector count", async () => {
    await registerAssetInArch(tmpRoot, {
      kind: "util",
      name: "JsonUtils",
      module: "demo",
      sourcePath: "demo/src/JsonUtils.java",
      summary: "old",
      whenToUse: "old",
      howToUse: "old",
    });

    await fs.writeFile(
      path.join(tmpRoot, "demo", "src", "JsonUtils.java"),
      "public class JsonUtils { void changed() {} }",
      "utf-8"
    );

    const lastScan: LastScanState = {
      version: 2,
      commit: "nogit",
      branch: "nogit",
      scannedAt: new Date().toISOString(),
      modules: {
        demo: {
          sourcePath: "demo",
          assetCount: 1,
          fileHashes: { "demo/src/JsonUtils.java": "stale-hash" },
        },
      },
      packages: {},
    };
    await writeLastScan(tmpRoot, lastScan);

    const storeBefore = new VectorStore(getVectorsDbPath(tmpRoot));
    const countBefore = storeBefore.listSourcePaths().length;
    storeBefore.close();

    const report = await runSyncChanges(tmpRoot, { dryRun: true });
    expect(report.audit.modified.length).toBeGreaterThan(0);
    expect(report.refreshed).toHaveLength(0);

    const storeAfter = new VectorStore(getVectorsDbPath(tmpRoot));
    expect(storeAfter.listSourcePaths().length).toBe(countBefore);
    storeAfter.close();
  });

  it("non-dry-run refreshes modified assets", async () => {
    await registerAssetInArch(tmpRoot, {
      kind: "util",
      name: "JsonUtils",
      module: "demo",
      sourcePath: "demo/src/JsonUtils.java",
      summary: "old",
      whenToUse: "old",
      howToUse: "old",
    });

    await fs.writeFile(
      path.join(tmpRoot, "demo", "src", "JsonUtils.java"),
      "public class JsonUtils { void changed() {} }",
      "utf-8"
    );

    await writeLastScan(tmpRoot, {
      version: 2,
      commit: "nogit",
      branch: "nogit",
      scannedAt: new Date().toISOString(),
      modules: {
        demo: {
          sourcePath: "demo",
          assetCount: 1,
          fileHashes: { "demo/src/JsonUtils.java": "stale-hash" },
        },
      },
      packages: {},
    });

    const report = await runSyncChanges(
      tmpRoot,
      { dryRun: false },
      { summarizeFn: mockSummarize }
    );
    expect(report.refreshed).toHaveLength(1);
    expect(report.refreshed[0]?.id).toBe("backend/demo/util/JsonUtils");

    const reaudit = await auditArchChanges(tmpRoot);
    expect(reaudit.modified).toHaveLength(0);
  });
});
