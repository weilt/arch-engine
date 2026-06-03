import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetCardsToChunks } from "../src/asset/chunks-from-cards.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { getArchDir, getVectorsDbPath } from "../src/paths.js";
import { runModuleBatch, runStartInit } from "../src/pipeline.js";
import type { AssetCard, RawCandidate } from "../src/types.js";
import { VectorStore } from "../src/vector/sqlite-store.js";
import type { SummarizeFn } from "../src/summarize/batch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "fixtures");

function cardFromCandidate(
  candidate: RawCandidate,
  scope: "backend" | "frontend"
): AssetCard {
  return {
    id: `${scope}/${candidate.moduleSlug}/${candidate.kind}/${candidate.name}`,
    kind: candidate.kind,
    name: candidate.name,
    module: candidate.moduleSlug,
    path: candidate.filePath,
    summary: `${candidate.name} 的中文摘要`,
    whenToUse: `在需要 ${candidate.name} 时使用`,
    howToUse: `参考 ${candidate.filePath}`,
    exports: candidate.signatures,
    related: [],
    tags: ["mock"],
    source: "scan",
    updatedAt: "2026-06-02T12:00:00.000Z",
  };
}

function createMockSummarizeFn(): SummarizeFn {
  return vi.fn(async (_config, batch, scope) =>
    batch.map((candidate) => cardFromCandidate(candidate, scope))
  );
}

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
            embedding: [0.1 * (index + 1), 0.2 * (index + 1)],
            index,
          })),
        }),
      };
    }

    if (target.endsWith("/chat/completions")) {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: string }[];
      };
      const userContent =
        body.messages.find((m) => m.role === "user")?.content ?? "";
      const isSummarize = userContent.includes("Candidates (");
      if (isSummarize) {
        const match = userContent.match(/Candidates \((\d+)\):[\s\S]*(\[[\s\S]+\])/);
        const candidates = match ? (JSON.parse(match[2]!) as RawCandidate[]) : [];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    cards: candidates.map((c) => ({
                      kind: c.kind,
                      name: c.name,
                      summary: `${c.name} 摘要`,
                      whenToUse: "mock when",
                      howToUse: "mock how",
                      exports: c.signatures,
                      related: [],
                      tags: [],
                    })),
                  }),
                },
              },
            ],
          }),
        };
      }

      const pathMatch = userContent.match(/Context path: ([^\n]+)/);
      const pathKey = pathMatch?.[1] ?? "unknown";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chunks: [
                    {
                      title: `${pathKey} overview`,
                      text: `Overview content for ${pathKey}`,
                      keywords: ["overview"],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      };
    }

    throw new Error(`Unexpected fetch URL: ${target}`);
  });
}

async function setupBatchProject(tmpRoot: string): Promise<void> {
  await fs.cp(path.join(fixturesRoot, "java", "base-common"), path.join(tmpRoot, "base-common"), {
    recursive: true,
  });
  await fs.cp(
    path.join(fixturesRoot, "frontend", "pnpm-workspace.yaml"),
    path.join(tmpRoot, "pnpm-workspace.yaml")
  );
  await fs.cp(path.join(fixturesRoot, "frontend", "packages"), path.join(tmpRoot, "packages"), {
    recursive: true,
  });

  await fs.mkdir(path.join(tmpRoot, ".ai", "arch"), { recursive: true });
  await fs.writeFile(
    path.join(tmpRoot, ".ai", "arch", "arch.config.json"),
    JSON.stringify(DEFAULT_CONFIG, null, 2),
    "utf-8"
  );
}

describe("assetCardsToChunks", () => {
  it("includes whenToUse in chunk text", () => {
    const chunks = assetCardsToChunks(
      [
        {
          id: "backend/base-common/util/JsonUtils",
          kind: "util",
          name: "JsonUtils",
          module: "base-common",
          path: "base-common/src/JsonUtils.java",
          summary: "JSON 工具",
          whenToUse: "需要序列化时使用",
          howToUse: "JsonUtils.toJson(obj)",
          exports: ["toJson"],
          related: [],
          tags: [],
          source: "scan",
          updatedAt: "2026-06-02T00:00:00.000Z",
        },
      ],
      "backend"
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("When to use: 需要序列化时使用");
    expect(chunks[0]?.path).toBe("backend/base-common/util");
  });
});

describe("runModuleBatch", () => {
  let tmpRoot: string;
  let store: VectorStore;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arch-module-batch-"));
    await setupBatchProject(tmpRoot);
    process.env.OPENAI_API_KEY = "test";
    vi.stubGlobal("fetch", mockFetch());
    store = new VectorStore(getVectorsDbPath(tmpRoot));
    store.clear();
  });

  afterEach(async () => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    store.close();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("summarize → write docs → embed → insert for backend module", async () => {
    const candidates: RawCandidate[] = [
      {
        kind: "util",
        name: "JsonUtils",
        moduleSlug: "base-common",
        filePath: "base-common/src/main/java/com/example/common/util/JsonUtils.java",
        javadoc: "JSON 工具",
        signatures: ["public static String toJson(Object obj)"],
      },
    ];
    const summarizeFn = createMockSummarizeFn();

    const { cards, chunks } = await runModuleBatch(
      tmpRoot,
      DEFAULT_CONFIG,
      "backend",
      "base-common",
      candidates,
      store,
      { summarizeFn }
    );

    expect(cards).toHaveLength(1);
    expect(chunks).toHaveLength(1);
    expect(summarizeFn).toHaveBeenCalledTimes(1);

    const utilsMd = await fs.readFile(
      path.join(getArchDir(tmpRoot), "backend", "base-common", "utils.md"),
      "utf-8"
    );
    expect(utilsMd).toContain("JsonUtils");
    expect(utilsMd).toContain("的中文摘要");

    const hits = store.search([0.1, 0.2], 5);
    expect(hits.some((h) => h.summary.includes("When to use"))).toBe(true);
  });
});

describe("runStartInit batch orchestration", () => {
  let tmpRoot: string;
  let summarizeFn: SummarizeFn;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arch-pipeline-batch-"));
    await setupBatchProject(tmpRoot);
    process.env.OPENAI_API_KEY = "test";
    vi.stubGlobal("fetch", mockFetch());
    summarizeFn = createMockSummarizeFn();
  });

  afterEach(async () => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("loops modules/packages with mock summarize and writes asset docs", async () => {
    const report = await runStartInit(tmpRoot, { summarizeFn });

    expect(report.status).toBe("ok");
    if (report.status !== "ok") return;

    expect(report.chunkCount).toBeGreaterThan(0);
    expect(summarizeFn).toHaveBeenCalled();

    await expect(fs.stat(getVectorsDbPath(tmpRoot))).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(getArchDir(tmpRoot), "backend", "base-common", "utils.md"))
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(getArchDir(tmpRoot), "frontend", "ui", "components.md"))
    ).resolves.toBeDefined();
  });
});
