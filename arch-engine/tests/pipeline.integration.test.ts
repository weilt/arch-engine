import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { getArchIndexMdPath, getVectorsDbPath } from "../src/paths.js";
import { runStartInit } from "../src/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "fixtures");

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

      if (userContent.includes("Candidates (")) {
        const jsonMatch = userContent.match(/Candidates \(\d+\):\s*(\[[\s\S]+\])/);
        const candidates = jsonMatch
          ? (JSON.parse(jsonMatch[1]!) as { name: string; kind: string; signatures: string[] }[])
          : [];
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
                      whenToUse: "集成测试场景",
                      howToUse: "集成测试用法",
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

async function setupDemoProject(tmpRoot: string): Promise<void> {
  await fs.cp(path.join(fixturesRoot, "java-module"), tmpRoot, {
    recursive: true,
  });

  await fs.cp(
    path.join(fixturesRoot, "frontend", "pnpm-workspace.yaml"),
    path.join(tmpRoot, "pnpm-workspace.yaml")
  );
  await fs.cp(path.join(fixturesRoot, "frontend", "packages"), path.join(tmpRoot, "packages"), {
    recursive: true,
  });

  await fs.mkdir(path.join(tmpRoot, "docs"), { recursive: true });
  await fs.cp(
    path.join(fixturesRoot, "openapi", "petstore.json"),
    path.join(tmpRoot, "docs", "petstore.json")
  );

  await fs.mkdir(path.join(tmpRoot, ".ai", "arch"), { recursive: true });
  const config = {
    ...DEFAULT_CONFIG,
    apiSpecGlobs: ["docs/**/*.json"],
  };
  await fs.writeFile(
    path.join(tmpRoot, ".ai", "arch", "arch.config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}

describe("runStartInit integration", () => {
  let tmpRoot: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arch-pipeline-"));
    await setupDemoProject(tmpRoot);
    process.env.OPENAI_API_KEY = "test";
    fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("generates vectors.db and INDEX.md from fixture monorepo", async () => {
    const report = await runStartInit(tmpRoot);

    expect(report.status).toBe("ok");
    if (report.status !== "ok") return;

    expect(report.chunkCount).toBeGreaterThan(0);
    expect(report.apiCount).toBeGreaterThan(0);
    expect(report.moduleCount).toBeGreaterThan(0);

    await expect(fs.stat(getVectorsDbPath(tmpRoot))).resolves.toBeDefined();
    await expect(fs.stat(getArchIndexMdPath(tmpRoot))).resolves.toBeDefined();

    const indexMd = await fs.readFile(getArchIndexMdPath(tmpRoot), "utf-8");
    expect(indexMd).toContain("Architecture Index");

    expect(fetchMock).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/embeddings"))
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/chat/completions"))
    ).toBe(true);
  });

  it("returns config-created when arch.config.json is missing", async () => {
    const freshRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arch-pipeline-fresh-"));
    try {
      const report = await runStartInit(freshRoot);
      expect(report).toEqual({ status: "config-created" });
      await expect(
        fs.stat(path.join(freshRoot, ".ai", "arch", "arch.config.json"))
      ).resolves.toBeDefined();
    } finally {
      await fs.rm(freshRoot, { recursive: true, force: true });
    }
  });
});
