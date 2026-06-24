import fs from "node:fs/promises";
import path from "node:path";
import { loadOrInitConfig, resolveApiKey } from "../config.js";
import { embedQuery, embedTexts } from "../embedding/openai-compatible.js";
import type { ArchChunk, ArchConfig } from "../types.js";
import { VectorStore, type SearchHit } from "../vector/sqlite-store.js";
import {
  getDesignComponentsDir,
  getDesignPagesDir,
  getDesignStylePath,
  getDesignVectorsDbPath,
} from "./paths.js";
import type { DesignComponentCard, DesignPageRecipe } from "./types.js";

/** Keyword scores below this trigger semantic vector fallback in searchUi. */
export const KEYWORD_FALLBACK_THRESHOLD = 4;

const STYLE_CHUNK_MAX = 800;

export interface DesignIndexResult {
  indexed: number;
  skipped: boolean;
  warning?: string;
}

export interface DesignVectorHit {
  kind: "component" | "page";
  id: string;
  title: string;
  score: number;
  snippet?: string;
}

interface DesignChunkSpec {
  meta: ArchChunk;
  text: string;
  sourcePath?: string;
}

function canEmbed(config: ArchConfig): boolean {
  try {
    resolveApiKey(config, "embedding");
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

async function listJsonIds(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

function componentToText(card: DesignComponentCard): string {
  const lines = [`[design-component] ${card.id}`];
  if (card.role) lines.push(`Role: ${card.role}`);
  if (card.anatomy?.length) lines.push(`Anatomy: ${card.anatomy.join(", ")}`);
  if (card.states?.length) lines.push(`States: ${card.states.join(", ")}`);
  if (card.tokenRefs?.length) lines.push(`Tokens: ${card.tokenRefs.join(", ")}`);
  if (card.constraints?.length) lines.push(`Constraints: ${card.constraints.join("; ")}`);
  if (card.promptExcerpt) lines.push(`Prompt: ${card.promptExcerpt}`);
  return lines.join("\n");
}

function pageToText(page: DesignPageRecipe): string {
  const lines = [`[design-page] ${page.id}`, `Title: ${page.title}`];
  for (const region of page.regions ?? []) {
    lines.push(`Region ${region.id}: ${(region.components ?? []).join(", ")}`);
  }
  if (page.states) {
    for (const [state, cid] of Object.entries(page.states)) {
      if (cid) lines.push(`State ${state}: ${cid}`);
    }
  }
  return lines.join("\n");
}

export function chunkStyleMarkdown(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const sections = trimmed.split(/\n(?=## )/);
  const chunks: string[] = [];

  for (const section of sections) {
    if (section.length <= STYLE_CHUNK_MAX) {
      chunks.push(section);
      continue;
    }
    const paragraphs = section.split(/\n\n+/);
    let buf = "";
    for (const paragraph of paragraphs) {
      const next = buf ? `${buf}\n\n${paragraph}` : paragraph;
      if (next.length > STYLE_CHUNK_MAX && buf) {
        chunks.push(buf);
        buf = paragraph;
      } else {
        buf = next;
      }
    }
    if (buf) chunks.push(buf);
  }

  return chunks;
}

export async function collectDesignChunks(projectRoot: string): Promise<DesignChunkSpec[]> {
  const specs: DesignChunkSpec[] = [];

  const compDir = getDesignComponentsDir(projectRoot);
  for (const id of await listJsonIds(compDir)) {
    const card = await readJsonFile<DesignComponentCard>(path.join(compDir, `${id}.json`));
    if (!card) continue;
    const rel = `components/${id}.json`;
    specs.push({
      meta: {
        id: `design/components/${id}`,
        path: `design/components/${id}`,
        kind: "component",
        title: id,
        text: "",
      },
      text: componentToText(card),
      sourcePath: rel,
    });
  }

  const pageDir = getDesignPagesDir(projectRoot);
  for (const id of await listJsonIds(pageDir)) {
    const page = await readJsonFile<DesignPageRecipe>(path.join(pageDir, `${id}.json`));
    if (!page) continue;
    const rel = `pages/${id}.json`;
    specs.push({
      meta: {
        id: `design/pages/${id}`,
        path: `design/pages/${id}`,
        kind: "overview",
        title: page.title,
        text: "",
      },
      text: pageToText(page),
      sourcePath: rel,
    });
  }

  const style = await fs.readFile(getDesignStylePath(projectRoot), "utf-8").catch(() => "");
  const styleChunks = chunkStyleMarkdown(style);
  for (let i = 0; i < styleChunks.length; i++) {
    specs.push({
      meta: {
        id: `design/style/${i}`,
        path: "design/style",
        anchor: String(i),
        kind: "convention",
        title: "Design style",
        text: "",
      },
      text: styleChunks[i]!,
      sourcePath: "style.md",
    });
  }

  return specs;
}

function vectorHitToDesignHit(hit: SearchHit): DesignVectorHit | null {
  if (hit.path.startsWith("design/components/")) {
    const id = hit.path.slice("design/components/".length);
    return {
      kind: "component",
      id,
      title: id,
      score: hit.score,
      snippet: hit.summary.slice(0, 120),
    };
  }
  if (hit.path.startsWith("design/pages/")) {
    const id = hit.path.slice("design/pages/".length);
    return {
      kind: "page",
      id,
      title: hit.title || id,
      score: hit.score,
    };
  }
  return null;
}

export async function indexDesignKnowledge(projectRoot: string): Promise<DesignIndexResult> {
  const { config } = await loadOrInitConfig(projectRoot);
  if (!canEmbed(config)) {
    const warning =
      "Design vector index skipped: missing embedding API key (set embedding.apiKey or OPENAI_API_KEY)";
    console.warn(warning);
    return { indexed: 0, skipped: true, warning };
  }

  const specs = await collectDesignChunks(projectRoot);
  if (specs.length === 0) {
    return { indexed: 0, skipped: false };
  }

  const texts = specs.map((s) => s.text);
  const embeddings = await embedTexts(config, texts);

  const dbPath = getDesignVectorsDbPath(projectRoot);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  const store = new VectorStore(dbPath);
  try {
    store.clear();
    store.upsertChunks(
      specs.map((spec, i) => ({
        meta: { ...spec.meta, text: spec.text },
        embedding: embeddings[i]!,
        sourcePath: spec.sourcePath,
      }))
    );
  } finally {
    store.close();
  }

  return { indexed: specs.length, skipped: false };
}

/**
 * Re-index a subset of design ids (Task 3 incremental sync will implement partial updates).
 * Id forms: component id (e.g. `Button`), page id (e.g. `list-page`), or `style`.
 */
export async function reindexDesignIds(
  projectRoot: string,
  ids: string[]
): Promise<DesignIndexResult> {
  if (ids.length === 0) {
    return { indexed: 0, skipped: false };
  }
  return indexDesignKnowledge(projectRoot);
}

export async function searchDesignVectors(
  projectRoot: string,
  query: string,
  limit: number,
  kindFilter?: "component" | "page"
): Promise<DesignVectorHit[]> {
  if (limit <= 0) return [];

  const dbPath = getDesignVectorsDbPath(projectRoot);
  try {
    await fs.access(dbPath);
  } catch {
    return [];
  }

  const { config } = await loadOrInitConfig(projectRoot);
  if (!canEmbed(config)) {
    return [];
  }

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(config, query);
  } catch {
    return [];
  }

  const archKind =
    kindFilter === "component" ? "component" : kindFilter === "page" ? "overview" : undefined;

  const store = new VectorStore(dbPath);
  try {
    const hits = store.search(queryEmbedding, Math.max(limit * 2, limit), archKind);
    return hits
      .map(vectorHitToDesignHit)
      .filter((h): h is DesignVectorHit => h != null)
      .slice(0, limit);
  } finally {
    store.close();
  }
}
