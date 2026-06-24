import fs from "node:fs/promises";
import path from "node:path";
import {
  getDesignComponentsDir,
  getDesignDir,
  getDesignGapsPath,
  getDesignPagesDir,
  getDesignProfilePath,
  getDesignRefsDir,
  getDesignStylePath,
  getDesignTokensDir,
} from "./paths.js";
import { readFrameworkBindings, resolveComponentBinding } from "./bindings.js";
import type { DesignComponentCard, DesignGapRequest, DesignPageRecipe, DesignProfile, FrameworkBindingEntry } from "./types.js";
import { assertDesignId } from "./ids.js";
import { MissingDesignProfileError, DesignComponentNotFoundError, DesignPageNotFoundError } from "./errors.js";
import type {
  QueryDesignOptions,
  QueryDesignResult,
  SearchUiHit,
  SearchUiOptions,
} from "./types.js";
import {
  KEYWORD_FALLBACK_THRESHOLD,
  searchDesignVectors,
} from "./vectors.js";

export async function readDesignProfile(projectRoot: string): Promise<DesignProfile> {
  try {
    const raw = await fs.readFile(getDesignProfilePath(projectRoot), "utf-8");
    return JSON.parse(raw) as DesignProfile;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MissingDesignProfileError();
    }
    throw e;
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

async function loadAllTokens(projectRoot: string): Promise<Record<string, Record<string, string>>> {
  const tokensDir = getDesignTokensDir(projectRoot);
  const out: Record<string, Record<string, string>> = {};
  try {
    const files = await fs.readdir(tokensDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const bucket = file.replace(/\.json$/, "");
      const data = await readJsonFile<Record<string, string>>(path.join(tokensDir, file));
      if (data) out[bucket] = data;
    }
  } catch {
    // no tokens dir
  }
  return out;
}

function isStale(profile: DesignProfile): boolean {
  if (!profile.sourceMtimeMs || !profile.syncedAt) return false;
  const syncedMs = Date.parse(profile.syncedAt);
  return Number.isFinite(syncedMs) && profile.sourceMtimeMs > syncedMs;
}

export async function queryDesign(
  projectRoot: string,
  options: QueryDesignOptions
): Promise<QueryDesignResult> {
  const profile = await readDesignProfile(projectRoot);
  const stale = isStale(profile);

  if (options.component) {
    assertDesignId(options.component, "component");
    const card = await readJsonFile<DesignComponentCard>(
      path.join(getDesignComponentsDir(projectRoot), `${options.component}.json`)
    );
    if (!card) throw new DesignComponentNotFoundError(options.component);
    const bindings = await readFrameworkBindings(projectRoot);
    const binding: FrameworkBindingEntry | null = resolveComponentBinding(
      bindings,
      options.component
    );
    return { kind: "component", component: card, binding, stale };
  }

  if (options.page) {
    assertDesignId(options.page, "page");
    const page = await readJsonFile<DesignPageRecipe>(
      path.join(getDesignPagesDir(projectRoot), `${options.page}.json`)
    );
    if (!page) throw new DesignPageNotFoundError(options.page);
    const gaps: string[] = [];
    const componentIds = new Set(await listJsonIds(getDesignComponentsDir(projectRoot)));
    for (const region of page.regions ?? []) {
      for (const cid of region.components ?? []) {
        if (!componentIds.has(cid)) gaps.push(cid);
      }
    }
    for (const cid of Object.values(page.states ?? {})) {
      if (cid && !componentIds.has(cid)) gaps.push(cid);
    }
    return { kind: "page", page, stale, gaps: [...new Set(gaps)] };
  }

  const style = await fs.readFile(getDesignStylePath(projectRoot), "utf-8").catch(() => "");
  const tokens = await loadAllTokens(projectRoot);
  const bindings = await readFrameworkBindings(projectRoot);
  return { kind: "global", profile, style, tokens, bindings, stale };
}

function scoreText(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 10;
  const parts = q.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const p of parts) {
    if (t.includes(p)) score += 2;
  }
  return score;
}

export async function searchUi(
  projectRoot: string,
  options: SearchUiOptions
): Promise<SearchUiHit[]> {
  await readDesignProfile(projectRoot);
  const limit = options.limit ?? 5;
  const hits: SearchUiHit[] = [];
  const kindFilter = options.filter?.kind;

  if (kindFilter !== "page") {
    const compDir = getDesignComponentsDir(projectRoot);
    for (const id of await listJsonIds(compDir)) {
      const card = await readJsonFile<DesignComponentCard>(path.join(compDir, `${id}.json`));
      if (!card) continue;
      const blob = [card.id, card.role ?? "", card.promptExcerpt ?? ""].join(" ");
      const score = scoreText(options.query, blob);
      if (score > 0) {
        hits.push({
          kind: "component",
          id: card.id,
          title: card.id,
          score,
          snippet: card.role ?? card.promptExcerpt?.slice(0, 120),
        });
      }
    }
  }

  if (kindFilter !== "component") {
    const pageDir = getDesignPagesDir(projectRoot);
    for (const id of await listJsonIds(pageDir)) {
      const page = await readJsonFile<{ id: string; title: string }>(
        path.join(pageDir, `${id}.json`)
      );
      if (!page) continue;
      const score = scoreText(options.query, `${page.id} ${page.title}`);
      if (score > 0) {
        hits.push({
          kind: "page",
          id: page.id,
          title: page.title,
          score,
        });
      }
    }
  }

  const sorted = hits.sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;

  if (topScore >= KEYWORD_FALLBACK_THRESHOLD) {
    return sorted.slice(0, limit);
  }

  const vectorHits = await searchDesignVectors(
    projectRoot,
    options.query,
    limit,
    kindFilter
  );
  if (vectorHits.length === 0) {
    return sorted.slice(0, limit);
  }

  const combined: SearchUiHit[] = [...sorted];
  for (const v of vectorHits) {
    if (combined.some((h) => h.kind === v.kind && h.id === v.id)) continue;
    combined.push({
      kind: v.kind,
      id: v.id,
      title: v.title,
      score: v.score * 10,
      snippet: v.snippet,
    });
  }

  return combined.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function appendDesignGap(
  projectRoot: string,
  gap: Omit<DesignGapRequest, "reportedAt">
): Promise<void> {
  const designDir = getDesignDir(projectRoot);
  await fs.mkdir(designDir, { recursive: true });
  const gapsPath = getDesignGapsPath(projectRoot);
  let gaps: DesignGapRequest[] = [];
  try {
    gaps = JSON.parse(await fs.readFile(gapsPath, "utf-8")) as DesignGapRequest[];
  } catch {
    gaps = [];
  }
  gaps.push({ ...gap, reportedAt: new Date().toISOString() });
  await fs.writeFile(gapsPath, JSON.stringify(gaps, null, 2), "utf-8");
}
