import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VectorStore } from "../../src/vector/sqlite-store.js";
import type { ArchChunk } from "../../src/types.js";

function chunk(
  id: string,
  pathKey: string,
  kind: ArchChunk["kind"],
  title: string
): ArchChunk {
  return { id, path: pathKey, kind, title, text: `Summary for ${title}` };
}

describe("VectorStore", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: VectorStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vector-store-"));
    dbPath = path.join(tmpDir, "vectors.db");
  });

  afterEach(async () => {
    store?.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns nearest neighbor among three orthogonal vectors", () => {
    store = new VectorStore(dbPath);
    const rows = [
      { meta: chunk("a", "backend/a", "api", "A"), embedding: [1, 0, 0] },
      { meta: chunk("b", "backend/b", "api", "B"), embedding: [0, 1, 0] },
      { meta: chunk("c", "frontend/c", "overview", "C"), embedding: [0, 0, 1] },
    ];
    store.insert(rows);

    const hits = store.search([0.9, 0.1, 0], 3);
    expect(hits).toHaveLength(3);
    expect(hits[0]!.path).toBe("backend/a");
    expect(hits[0]!.kind).toBe("api");
    expect(hits[0]!.summary).toBe("Summary for A");
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[1]!.score).toBeGreaterThan(hits[2]!.score);
  });

  it("clear removes all rows before re-insert", () => {
    store = new VectorStore(dbPath);
    store.insert([
      { meta: chunk("only", "path/only", "util", "Only"), embedding: [1, 0] },
    ]);
    store.clear();
    store.insert([
      { meta: chunk("new", "path/new", "rpc", "New"), embedding: [0, 1] },
    ]);

    const hits = store.search([0, 1], 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.path).toBe("path/new");
  });

  it("filters by kind when provided", () => {
    store = new VectorStore(dbPath);
    store.insert([
      { meta: chunk("a", "backend/a", "api", "A"), embedding: [1, 0, 0] },
      { meta: chunk("b", "frontend/b", "overview", "B"), embedding: [0.9, 0.1, 0] },
    ]);

    const hits = store.search([1, 0, 0], 5, "api");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("api");
  });
});
