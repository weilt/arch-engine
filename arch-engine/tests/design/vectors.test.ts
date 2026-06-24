import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VectorStore } from "../../src/vector/sqlite-store.js";
import {
  KEYWORD_FALLBACK_THRESHOLD,
  chunkStyleMarkdown,
  collectDesignChunks,
  indexDesignKnowledge,
  searchDesignVectors,
} from "../../src/design/vectors.js";
import { searchUi } from "../../src/design/query.js";
import { getDesignVectorsDbPath } from "../../src/design/paths.js";
import type { DesignProfile } from "../../src/design/types.js";

async function writeMinimalDesign(projectRoot: string): Promise<void> {
  const designDir = path.join(projectRoot, ".ai", "design");
  await fs.mkdir(path.join(designDir, "components"), { recursive: true });
  await fs.mkdir(path.join(designDir, "pages"), { recursive: true });

  const profile: DesignProfile = {
    version: 1,
    primarySource: { tool: "baoyu", path: "designs/test" },
    sources: [],
    syncedAt: new Date().toISOString(),
    componentCount: 1,
    pageCount: 1,
    warnings: [],
  };
  await fs.writeFile(path.join(designDir, "profile.json"), JSON.stringify(profile), "utf-8");
  await fs.writeFile(
    path.join(designDir, "style.md"),
    "# Style\n\nUse calm blues.\n\n## Typography\n\nPrefer sans-serif.\n",
    "utf-8"
  );
  await fs.writeFile(
    path.join(designDir, "components", "PrimaryButton.json"),
    JSON.stringify({
      id: "PrimaryButton",
      role: "Main call-to-action",
      promptExcerpt: "Filled primary action control",
    }),
    "utf-8"
  );
  await fs.writeFile(
    path.join(designDir, "pages", "checkout.json"),
    JSON.stringify({
      id: "checkout",
      title: "Checkout flow",
      regions: [{ id: "main", components: ["PrimaryButton"] }],
    }),
    "utf-8"
  );
}

describe("design vectors", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "design-vectors-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("resolves design-vectors.db under .ai/design", () => {
    expect(getDesignVectorsDbPath("/proj")).toMatch(/\.ai[\\/]design[\\/]design-vectors\.db$/);
  });

  it("chunks style.md by sections and size", () => {
    const chunks = chunkStyleMarkdown("# Title\n\nBody.\n\n## Section\n\nMore text.");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.includes("Section"))).toBe(true);
  });

  it("collectDesignChunks includes component, page, and style slices", async () => {
    await writeMinimalDesign(tmpRoot);
    const specs = await collectDesignChunks(tmpRoot);
    expect(specs.some((s) => s.meta.path === "design/components/PrimaryButton")).toBe(true);
    expect(specs.some((s) => s.meta.path === "design/pages/checkout")).toBe(true);
    expect(specs.some((s) => s.meta.path === "design/style")).toBe(true);
  });

  it("indexDesignKnowledge skips when embedding API key is missing", async () => {
    await writeMinimalDesign(tmpRoot);
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await indexDesignKnowledge(tmpRoot);

    expect(result.skipped).toBe(true);
    expect(result.warning).toContain("missing embedding API key");
    expect(warn).toHaveBeenCalled();
    await expect(fs.access(getDesignVectorsDbPath(tmpRoot))).rejects.toThrow();

    if (prev) process.env.OPENAI_API_KEY = prev;
  });

  it("searchDesignVectors returns hits from pre-populated db", async () => {
    await writeMinimalDesign(tmpRoot);
    const dbPath = getDesignVectorsDbPath(tmpRoot);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    const store = new VectorStore(dbPath);
    store.upsertChunks([
      {
        meta: {
          id: "design/components/PrimaryButton",
          path: "design/components/PrimaryButton",
          kind: "component",
          title: "PrimaryButton",
          text: "Main call-to-action",
        },
        embedding: [1, 0, 0],
        sourcePath: "components/PrimaryButton.json",
      },
      {
        meta: {
          id: "design/pages/checkout",
          path: "design/pages/checkout",
          kind: "overview",
          title: "Checkout flow",
          text: "Checkout page recipe",
        },
        embedding: [0, 1, 0],
        sourcePath: "pages/checkout.json",
      },
    ]);
    store.close();

    vi.spyOn(
      await import("../../src/embedding/openai-compatible.js"),
      "embedQuery"
    ).mockResolvedValue([0.95, 0.05, 0]);

    const hits = await searchDesignVectors(tmpRoot, "submit purchase", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.kind).toBe("component");
    expect(hits[0]!.id).toBe("PrimaryButton");

    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
  });

  it("searchUi uses keyword results when score meets threshold", async () => {
    await writeMinimalDesign(tmpRoot);
    const hits = await searchUi(tmpRoot, { query: "PrimaryButton" });
    expect(hits.some((h) => h.id === "PrimaryButton")).toBe(true);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(KEYWORD_FALLBACK_THRESHOLD);
  });

  it("searchUi falls back to vectors when keyword score is low", async () => {
    await writeMinimalDesign(tmpRoot);

    vi.spyOn(
      await import("../../src/design/vectors.js"),
      "searchDesignVectors"
    ).mockResolvedValue([
      {
        kind: "component",
        id: "PrimaryButton",
        title: "PrimaryButton",
        score: 0.92,
        snippet: "Main call-to-action",
      },
    ]);

    const hits = await searchUi(tmpRoot, { query: "xyznonexistent" });
    expect(hits.some((h) => h.id === "PrimaryButton")).toBe(true);
  });
});
