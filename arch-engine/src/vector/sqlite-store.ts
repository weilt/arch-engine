import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type { ArchChunk } from "../types.js";

export interface SearchHit {
  path: string;
  anchor?: string;
  kind: ArchChunk["kind"];
  summary: string;
  score: number;
  /** Stable AssetCard id when chunk originated from an asset card. */
  assetId?: string;
  /** Relative project-root source file path when known. */
  sourcePath?: string;
}

interface ChunkRow {
  id: string;
  path: string;
  anchor: string | null;
  kind: ArchChunk["kind"];
  title: string;
  summary: string;
  source_path: string | null;
}

interface KnnRow {
  chunk_id: string;
  distance: number;
}

const VEC_TABLE = "chunk_vectors";
const META_KEY_DIM = "embedding_dim";

function isAssetChunkId(id: string): boolean {
  return /^(backend|frontend)\/[^/]+\/(api|rpc|component|util|enum|starter|pojo)\/.+/.test(
    id
  );
}

function embeddingToMatchParam(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

export class VectorStore {
  private db: Database.Database;
  private embeddingDim: number | null = null;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    try {
      sqliteVec.load(this.db);
    } catch (err) {
      this.db.close();
      throw new Error(
        `Failed to load sqlite-vec extension: ${err instanceof Error ? err.message : err}. ` +
          "Ensure sqlite-vec is installed (npm install sqlite-vec)."
      );
    }
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vec_store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        anchor TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_path TEXT
      );
    `);
    this.ensureSourcePathColumn();
    this.embeddingDim = this.readStoredDim() ?? this.inferDimFromLegacyEmbeddings();
    if (this.embeddingDim != null) {
      this.ensureVecTable(this.embeddingDim);
    }
    this.migrateLegacyEmbeddingsIfNeeded();
    this.dropLegacyEmbeddingColumn();
  }

  private inferDimFromLegacyEmbeddings(): number | null {
    const columns = this.db
      .prepare("PRAGMA table_info(chunks)")
      .all() as { name: string }[];
    if (!columns.some((c) => c.name === "embedding")) {
      return null;
    }
    const row = this.db
      .prepare("SELECT embedding FROM chunks WHERE embedding IS NOT NULL LIMIT 1")
      .get() as { embedding: Buffer } | undefined;
    if (!row?.embedding?.length) {
      return null;
    }
    const dim = row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT;
    if (!Number.isFinite(dim) || dim <= 0) {
      return null;
    }
    this.storeDim(dim);
    return dim;
  }

  private ensureSourcePathColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(chunks)")
      .all() as { name: string }[];
    if (!columns.some((c) => c.name === "source_path")) {
      this.db.exec("ALTER TABLE chunks ADD COLUMN source_path TEXT");
    }
  }

  /** Older DBs stored embeddings on chunks; vec0 is the source of truth now. */
  private dropLegacyEmbeddingColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(chunks)")
      .all() as { name: string }[];
    if (!columns.some((c) => c.name === "embedding")) {
      return;
    }
    this.db.exec(`
      CREATE TABLE chunks_new (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        anchor TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_path TEXT
      );
      INSERT INTO chunks_new (id, path, anchor, kind, title, summary, source_path)
      SELECT id, path, anchor, kind, title, summary, source_path FROM chunks;
      DROP TABLE chunks;
      ALTER TABLE chunks_new RENAME TO chunks;
    `);
  }

  private readStoredDim(): number | null {
    const row = this.db
      .prepare("SELECT value FROM vec_store_meta WHERE key = ?")
      .get(META_KEY_DIM) as { value: string } | undefined;
    if (!row) return null;
    const dim = Number.parseInt(row.value, 10);
    return Number.isFinite(dim) && dim > 0 ? dim : null;
  }

  private storeDim(dim: number): void {
    this.db
      .prepare(
        `INSERT INTO vec_store_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(META_KEY_DIM, String(dim));
    this.embeddingDim = dim;
  }

  private vecTableExists(): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type IN ('table', 'shadow') AND name = ?`
      )
      .get(VEC_TABLE);
    return row != null;
  }

  private ensureVecTable(dim: number): void {
    if (this.vecTableExists()) {
      return;
    }
    this.db.exec(`
      CREATE VIRTUAL TABLE ${VEC_TABLE} USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding FLOAT[${dim}] distance_metric=cosine,
        kind TEXT
      );
    `);
  }

  private resolveDim(embedding: number[]): number {
    const dim = embedding.length;
    if (dim <= 0) {
      throw new Error("Embedding must have at least one dimension");
    }
    if (this.embeddingDim == null) {
      this.storeDim(dim);
      this.ensureVecTable(dim);
      return dim;
    }
    if (this.embeddingDim !== dim) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.embeddingDim}, got ${dim}. ` +
          "Re-run start-init --full to rebuild the vector index."
      );
    }
    if (!this.vecTableExists()) {
      this.ensureVecTable(dim);
    }
    return dim;
  }

  /** One-time migration from pre-vec0 DB files that still had embedding blobs. */
  private migrateLegacyEmbeddingsIfNeeded(): void {
    if (!this.vecTableExists() || this.embeddingDim == null) {
      return;
    }
    const vecCount = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM ${VEC_TABLE}`).get() as { n: number }
    ).n;
    if (vecCount > 0) {
      return;
    }
    const columns = this.db
      .prepare("PRAGMA table_info(chunks)")
      .all() as { name: string }[];
    if (!columns.some((c) => c.name === "embedding")) {
      return;
    }
    const legacy = this.db
      .prepare("SELECT id, kind, embedding FROM chunks WHERE embedding IS NOT NULL")
      .all() as { id: string; kind: string; embedding: Buffer }[];
    if (legacy.length === 0) {
      return;
    }
    const deleteVec = this.db.prepare(`DELETE FROM ${VEC_TABLE} WHERE chunk_id = ?`);
    const insertVec = this.db.prepare(
      `INSERT INTO ${VEC_TABLE} (chunk_id, embedding, kind) VALUES (?, ?, ?)`
    );
    const tx = this.db.transaction((rows: typeof legacy) => {
      for (const row of rows) {
        deleteVec.run(row.id);
        insertVec.run(row.id, row.embedding, row.kind);
      }
    });
    tx(legacy);
    this.dropLegacyEmbeddingColumn();
  }

  clear(): void {
    this.db.exec("DELETE FROM chunks");
    if (this.vecTableExists()) {
      this.db.exec(`DELETE FROM ${VEC_TABLE}`);
    }
  }

  insert(rows: { meta: ArchChunk; embedding: number[]; sourcePath?: string }[]): void {
    this.upsertChunks(rows);
  }

  upsertChunks(
    rows: { meta: ArchChunk; embedding: number[]; sourcePath?: string }[]
  ): void {
    if (rows.length === 0) return;

    this.resolveDim(rows[0]!.embedding);

    const metaStmt = this.db.prepare(
      `INSERT INTO chunks (id, path, anchor, kind, title, summary, source_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         path = excluded.path,
         anchor = excluded.anchor,
         kind = excluded.kind,
         title = excluded.title,
         summary = excluded.summary,
         source_path = excluded.source_path`
    );

    const deleteVec = this.db.prepare(`DELETE FROM ${VEC_TABLE} WHERE chunk_id = ?`);
    const insertVec = this.db.prepare(
      `INSERT INTO ${VEC_TABLE} (chunk_id, embedding, kind) VALUES (?, ?, ?)`
    );

    const tx = this.db.transaction(
      (items: { meta: ArchChunk; embedding: number[]; sourcePath?: string }[]) => {
        for (const { meta, embedding, sourcePath } of items) {
          if (embedding.length !== this.embeddingDim) {
            throw new Error(
              `Embedding dimension mismatch in batch: expected ${this.embeddingDim}, got ${embedding.length}`
            );
          }
          metaStmt.run(
            meta.id,
            meta.path,
            meta.anchor ?? null,
            meta.kind,
            meta.title,
            meta.text.slice(0, 500),
            sourcePath ?? null
          );
          deleteVec.run(meta.id);
          insertVec.run(meta.id, embeddingToMatchParam(embedding), meta.kind);
        }
      }
    );
    tx(rows);
  }

  deleteByIds(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    this.db.prepare(`DELETE FROM chunks WHERE id IN (${placeholders})`).run(...ids);
    if (this.vecTableExists()) {
      this.db
        .prepare(`DELETE FROM ${VEC_TABLE} WHERE chunk_id IN (${placeholders})`)
        .run(...ids);
    }
  }

  deleteByModule(modulePrefix: string): void {
    const idLike = `${modulePrefix}/%`;
    const pathLike = `${modulePrefix}%`;
    const ids = this.db
      .prepare("SELECT id FROM chunks WHERE id LIKE ? OR path LIKE ?")
      .all(idLike, pathLike) as { id: string }[];
    this.db.prepare("DELETE FROM chunks WHERE id LIKE ? OR path LIKE ?").run(idLike, pathLike);
    if (this.vecTableExists() && ids.length > 0) {
      const placeholders = ids.map(() => "?").join(", ");
      this.db
        .prepare(`DELETE FROM ${VEC_TABLE} WHERE chunk_id IN (${placeholders})`)
        .run(...ids.map((r) => r.id));
    }
  }

  /** Delete chunks matching kind and path prefix (exact path or path/subpath). */
  deleteChunksByKindAndPathPrefix(
    kind: ArchChunk["kind"],
    pathPrefix: string
  ): void {
    const pathLike = `${pathPrefix}%`;
    const ids = this.db
      .prepare("SELECT id FROM chunks WHERE kind = ? AND path LIKE ?")
      .all(kind, pathLike) as { id: string }[];
    if (ids.length === 0) return;

    this.db
      .prepare("DELETE FROM chunks WHERE kind = ? AND path LIKE ?")
      .run(kind, pathLike);
    if (this.vecTableExists()) {
      const placeholders = ids.map(() => "?").join(", ");
      this.db
        .prepare(`DELETE FROM ${VEC_TABLE} WHERE chunk_id IN (${placeholders})`)
        .run(...ids.map((r) => r.id));
    }
  }

  listSourcePaths(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT source_path FROM chunks WHERE source_path IS NOT NULL AND source_path != ''`
      )
      .all() as { source_path: string }[];
    return rows.map((r) => r.source_path);
  }

  assetIdsBySourcePath(sourcePath: string): string[] {
    const rows = this.db
      .prepare(`SELECT id FROM chunks WHERE source_path = ?`)
      .all(sourcePath) as { id: string }[];
    return rows.map((r) => r.id).filter((id) => isAssetChunkId(id));
  }

  getSourcePathForAssetId(assetId: string): string | undefined {
    const row = this.db
      .prepare(`SELECT source_path FROM chunks WHERE id = ?`)
      .get(assetId) as { source_path: string | null } | undefined;
    const sp = row?.source_path;
    return sp && sp.length > 0 ? sp : undefined;
  }

  search(queryEmbedding: number[], limit: number, kind?: string): SearchHit[] {
    if (limit <= 0) return [];

    const dim = queryEmbedding.length;
    if (this.embeddingDim != null && dim !== this.embeddingDim) {
      throw new Error(
        `Query embedding dimension ${dim} does not match index dimension ${this.embeddingDim}`
      );
    }
    if (!this.vecTableExists()) {
      if (this.embeddingDim == null && dim > 0) {
        return [];
      }
      throw new Error("Vector index not initialized. Run start-init to build embeddings.");
    }

    const matchParam = embeddingToMatchParam(queryEmbedding);
    const k = Math.max(limit * 4, limit);

    let knnRows: KnnRow[];
    if (kind) {
      knnRows = this.db
        .prepare(
          `SELECT chunk_id, distance
           FROM ${VEC_TABLE}
           WHERE embedding MATCH ?
             AND k = ?
             AND kind = ?`
        )
        .all(matchParam, k, kind) as KnnRow[];
    } else {
      knnRows = this.db
        .prepare(
          `SELECT chunk_id, distance
           FROM ${VEC_TABLE}
           WHERE embedding MATCH ?
             AND k = ?`
        )
        .all(matchParam, k) as KnnRow[];
    }

    if (knnRows.length === 0) {
      return [];
    }

    const placeholders = knnRows.map(() => "?").join(", ");
    const chunkRows = this.db
      .prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`)
      .all(...knnRows.map((r) => r.chunk_id)) as ChunkRow[];

    const chunkById = new Map(chunkRows.map((r) => [r.id, r]));
    const distanceById = new Map(knnRows.map((r) => [r.chunk_id, r.distance]));

    const hits: SearchHit[] = [];
    for (const { chunk_id } of knnRows) {
      const r = chunkById.get(chunk_id);
      if (!r) continue;
      const distance = distanceById.get(chunk_id) ?? 1;
      hits.push({
        path: r.path,
        anchor: r.anchor ?? undefined,
        kind: r.kind,
        summary: r.summary,
        score: 1 - distance,
        assetId: isAssetChunkId(r.id) ? r.id : undefined,
        sourcePath: r.source_path ?? undefined,
      });
      if (hits.length >= limit) break;
    }

    return hits;
  }

  close(): void {
    this.db.close();
  }
}
