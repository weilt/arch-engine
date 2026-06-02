import Database from "better-sqlite3";
import type { ArchChunk } from "../types.js";

export interface SearchHit {
  path: string;
  anchor?: string;
  kind: ArchChunk["kind"];
  summary: string;
  score: number;
}

interface ChunkRow {
  id: string;
  path: string;
  anchor: string | null;
  kind: ArchChunk["kind"];
  title: string;
  summary: string;
  embedding: Buffer;
}

function blobToArray(blob: Buffer): number[] {
  const floats = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  return Array.from(floats);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

export class VectorStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        anchor TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        embedding BLOB NOT NULL
      );
    `);
  }

  clear(): void {
    this.db.exec("DELETE FROM chunks");
  }

  insert(rows: { meta: ArchChunk; embedding: number[] }[]): void {
    const stmt = this.db.prepare(
      "INSERT INTO chunks (id, path, anchor, kind, title, summary, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const tx = this.db.transaction((items: { meta: ArchChunk; embedding: number[] }[]) => {
      for (const { meta, embedding } of items) {
        const buf = Buffer.from(new Float32Array(embedding).buffer);
        stmt.run(
          meta.id,
          meta.path,
          meta.anchor ?? null,
          meta.kind,
          meta.title,
          meta.text.slice(0, 500),
          buf
        );
      }
    });
    tx(rows);
  }

  search(queryEmbedding: number[], limit: number, kind?: string): SearchHit[] {
    const rows = this.db.prepare("SELECT * FROM chunks").all() as ChunkRow[];
    return rows
      .filter((r) => !kind || r.kind === kind)
      .map((r) => ({
        path: r.path,
        anchor: r.anchor ?? undefined,
        kind: r.kind,
        summary: r.summary,
        score: cosineSimilarity(queryEmbedding, blobToArray(r.embedding)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  close(): void {
    this.db.close();
  }
}
