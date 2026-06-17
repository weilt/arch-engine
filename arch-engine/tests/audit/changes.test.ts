import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditArchChanges, MissingLastScanError } from "../../src/audit/changes.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { hashFileContent } from "../../src/incremental/file-hashes.js";
import { writeLastScan } from "../../src/incremental/last-scan.js";
import { registerAssetInArch } from "../../src/register-asset.js";
import type { LastScanState } from "../../src/types.js";

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

async function setupArchProject(tmpRoot: string): Promise<void> {
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
}

describe("auditArchChanges", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "audit-"));
    await setupArchProject(tmpRoot);
    process.env.OPENAI_API_KEY = "test";
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(async () => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("reports modified when file hash differs from last-scan (nogit)", async () => {
    const javaPath = path.join(tmpRoot, "demo", "src", "JsonUtils.java");
    await fs.writeFile(javaPath, "public class JsonUtils {}", "utf-8");

    await registerAssetInArch(tmpRoot, {
      kind: "util",
      name: "JsonUtils",
      module: "demo",
      sourcePath: "demo/src/JsonUtils.java",
      summary: "JSON helpers",
      whenToUse: "parse",
      howToUse: "parse()",
    });

    const currentHash = await hashFileContent(javaPath);
    const lastScan: LastScanState = {
      version: 2,
      commit: "nogit",
      branch: "nogit",
      scannedAt: "2026-06-16T00:00:00.000Z",
      modules: {
        demo: {
          sourcePath: "demo",
          assetCount: 1,
          fileHashes: {
            "demo/src/JsonUtils.java": "0".repeat(64),
          },
        },
      },
      packages: {},
    };
    expect(currentHash).not.toBe("0".repeat(64));
    await writeLastScan(tmpRoot, lastScan);

    const result = await auditArchChanges(tmpRoot);
    expect(result.anchor.mode).toBe("fileHashes");
    expect(result.modified.some((i) => i.sourcePath === "demo/src/JsonUtils.java")).toBe(
      true
    );
  });

  it("throws when last-scan.json is missing", async () => {
    await expect(auditArchChanges(tmpRoot)).rejects.toThrow(MissingLastScanError);
  });

  it("reports unregistered for new util file", async () => {
    await fs.writeFile(
      path.join(tmpRoot, "demo", "src", "BarUtils.java"),
      "public class BarUtils {}",
      "utf-8"
    );

    await writeLastScan(tmpRoot, {
      version: 2,
      commit: "nogit",
      branch: "nogit",
      scannedAt: "2026-06-16T00:00:00.000Z",
      modules: {
        demo: {
          sourcePath: "demo",
          assetCount: 0,
          fileHashes: {},
        },
      },
      packages: {},
    });

    const result = await auditArchChanges(tmpRoot);
    expect(
      result.unregistered.some(
        (i) => i.sourcePath === "demo/src/BarUtils.java" && i.suggestedName === "BarUtils"
      )
    ).toBe(true);
  });
});
