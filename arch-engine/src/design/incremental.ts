import fs from "node:fs/promises";
import path from "node:path";
import {
  collectRefFiles,
  ingestBaoyuSource,
  readBaoyuMeta,
} from "./ingest/baoyu.js";
import { assertDesignId } from "./ids.js";
import {
  getDesignComponentsDir,
  getDesignDir,
  getDesignIngestStatePath,
  getDesignPagesDir,
  getDesignProfilePath,
  getDesignRefsDir,
  getDesignStylePath,
  getDesignTokensDir,
} from "./paths.js";
import { runDesignSync } from "./sync.js";
import type {
  ChangedSources,
  DesignComponentCard,
  DesignIngestState,
  DesignProfile,
  DesignSyncOptions,
  DesignSyncReport,
} from "./types.js";
import { reindexDesignIds } from "./vectors.js";

const MTIME_EPSILON_MS = 0.5;

export interface AffectedDesignTargets {
  tokens: boolean;
  style: boolean;
  componentIds: Set<string>;
  allComponents: boolean;
  pages: boolean;
  refs: boolean;
}

async function writeJson(filePath: string, data: unknown, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

async function copyRef(
  fromAbs: string,
  refsDir: string,
  name: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;
  await fs.mkdir(refsDir, { recursive: true });
  await fs.copyFile(fromAbs, path.join(refsDir, name));
}

async function walkSourceFiles(
  projectRoot: string,
  sourceRel: string
): Promise<Record<string, number>> {
  const sourceAbs = path.resolve(projectRoot, sourceRel);
  const files: Record<string, number> = {};

  async function walk(dirAbs: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(projectRoot, full).replace(/\\/g, "/");
        const st = await fs.stat(full);
        files[rel] = st.mtimeMs;
      }
    }
  }

  await walk(sourceAbs);
  return files;
}

export async function readIngestState(
  projectRoot: string
): Promise<DesignIngestState | null> {
  try {
    const raw = await fs.readFile(getDesignIngestStatePath(projectRoot), "utf-8");
    const parsed = JSON.parse(raw) as DesignIngestState;
    if (parsed.version !== 1 || typeof parsed.sourceRel !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeIngestState(
  projectRoot: string,
  state: DesignIngestState,
  dryRun: boolean
): Promise<void> {
  await writeJson(getDesignIngestStatePath(projectRoot), state, dryRun);
}

export async function snapshotSourceFiles(
  projectRoot: string,
  sourceRel: string
): Promise<Record<string, number>> {
  return walkSourceFiles(projectRoot, sourceRel);
}

export function detectChangedSources(
  currentFiles: Record<string, number>,
  priorState: DesignIngestState | null
): ChangedSources {
  if (!priorState) {
    const all = Object.keys(currentFiles);
    return { added: all, modified: [], deleted: [], all };
  }

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [rel, mtime] of Object.entries(currentFiles)) {
    const prev = priorState.files[rel];
    if (prev === undefined) {
      added.push(rel);
    } else if (Math.abs(prev - mtime) > MTIME_EPSILON_MS) {
      modified.push(rel);
    }
  }

  for (const rel of Object.keys(priorState.files)) {
    if (!(rel in currentFiles)) {
      deleted.push(rel);
    }
  }

  return {
    added,
    modified,
    deleted,
    all: [...added, ...modified, ...deleted],
  };
}

/** Compare current source tree mtimes against persisted ingest state. */
export async function detectChangedSourcesForProject(
  projectRoot: string,
  sourceRel: string,
  priorState?: DesignIngestState | null
): Promise<ChangedSources> {
  const state = priorState === undefined ? await readIngestState(projectRoot) : priorState;
  const currentFiles = await snapshotSourceFiles(projectRoot, sourceRel);
  return detectChangedSources(currentFiles, state);
}

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, "/");
}

function relWithinSource(rel: string, sourceRel: string): string {
  const norm = normalizeRel(rel);
  const prefix = `${normalizeRel(sourceRel)}/`;
  if (norm === normalizeRel(sourceRel)) return "";
  if (norm.startsWith(prefix)) {
    return norm.slice(prefix.length);
  }
  return norm;
}

function componentIdFromPromptPath(withinSource: string): string | null {
  const m =
    withinSource.match(/^components\/([^/]+)\.prompt\.md$/) ??
    withinSource.match(/^components\/([^/]+)\/[^/]+\.prompt\.md$/);
  return m?.[1] ?? null;
}

export function classifyAffectedTargets(
  changedFiles: string[],
  sourceRel: string
): AffectedDesignTargets {
  const targets: AffectedDesignTargets = {
    tokens: false,
    style: false,
    componentIds: new Set<string>(),
    allComponents: false,
    pages: false,
    refs: false,
  };

  for (const rel of changedFiles) {
    const within = relWithinSource(rel, sourceRel);
    if (!within && normalizeRel(rel) !== normalizeRel(sourceRel)) {
      continue;
    }

    const base = within || path.basename(rel);
    if (
      base === "tokens.css" ||
      base === "styles.css" ||
      within.endsWith("/tokens.css") ||
      within.endsWith("/styles.css")
    ) {
      targets.tokens = true;
    }
    if (
      base === "_ds_prompt.md" ||
      base === "README.md" ||
      within.endsWith("/_ds_prompt.md")
    ) {
      targets.style = true;
    }
    if (base === "_ds_manifest.json" || within.endsWith("/_ds_manifest.json")) {
      targets.allComponents = true;
    }
    if (base === "_d_meta.json") {
      targets.pages = true;
      targets.refs = true;
    }

    const componentId = componentIdFromPromptPath(within);
    if (componentId) {
      targets.componentIds.add(componentId);
    }

    if (/\.(html|htm)$/i.test(within)) {
      targets.refs = true;
      targets.pages = true;
    }

    if (base === "page.manifest.json" || within.endsWith("/page.manifest.json")) {
      targets.pages = true;
      targets.refs = true;
    }
    if (base === "page.logic.md" || within.endsWith("/page.logic.md")) {
      targets.pages = true;
    }
    if (base === "page.tsx" || within.endsWith("/page.tsx")) {
      targets.pages = true;
      targets.refs = true;
    }
    if (base === "preview.html" || within.endsWith("/preview.html")) {
      targets.refs = true;
      targets.pages = true;
    }
  }

  return targets;
}

async function readExistingProfile(projectRoot: string): Promise<DesignProfile | null> {
  try {
    return JSON.parse(
      await fs.readFile(getDesignProfilePath(projectRoot), "utf-8")
    ) as DesignProfile;
  } catch {
    return null;
  }
}

async function resolveSourceRel(
  projectRoot: string,
  options: DesignSyncOptions
): Promise<string> {
  if (options.source) return options.source;
  const profile = await readExistingProfile(projectRoot);
  return profile?.primarySource.path ?? "designs";
}

export async function runIncrementalDesignSync(
  projectRoot: string,
  options: DesignSyncOptions = {}
): Promise<DesignSyncReport> {
  const dryRun = options.dryRun ?? false;
  const pagesOnly = options.pagesOnly ?? false;
  const sourceRel = await resolveSourceRel(projectRoot, options);

  const priorState = await readIngestState(projectRoot);
  const existingProfile = await readExistingProfile(projectRoot);

  if (!priorState || !existingProfile) {
    const report = await runDesignSync(projectRoot, { ...options, incremental: false });
    return { ...report, incremental: false };
  }

  if (priorState.sourceRel !== sourceRel) {
    const report = await runDesignSync(projectRoot, { ...options, incremental: false });
    return { ...report, incremental: false };
  }

  const currentFiles = await snapshotSourceFiles(projectRoot, sourceRel);
  const changes = detectChangedSources(currentFiles, priorState);

  if (changes.all.length === 0) {
    return {
      profile: existingProfile,
      componentsWritten: 0,
      pagesWritten: 0,
      tokenFiles: [],
      warnings: existingProfile.warnings,
      dryRun,
      incremental: true,
      changedFiles: [],
      reindexedIds: [],
    };
  }

  const ingested = await ingestBaoyuSource(projectRoot, sourceRel);
  const targets = classifyAffectedTargets(changes.all, sourceRel);
  const syncedAt = new Date().toISOString();

  const profile: DesignProfile = {
    ...existingProfile,
    ...ingested.profile,
    syncedAt,
    componentCount: ingested.components.length,
    pageCount: ingested.pages.length,
    warnings: [...new Set([...existingProfile.warnings, ...ingested.warnings])],
    sourceMtimeMs: ingested.sourceMtimeMs,
  };

  const tokenFiles: string[] = [];
  let componentsWritten = 0;
  let pagesWritten = 0;
  const reindexedIds = new Set<string>();

  if (!pagesOnly) {
    if (targets.tokens) {
      for (const [bucket, values] of Object.entries(ingested.tokens)) {
        if (Object.keys(values).length === 0) continue;
        const fileName = `${bucket}.json`;
        tokenFiles.push(fileName);
        await writeJson(path.join(getDesignTokensDir(projectRoot), fileName), values, dryRun);
      }
    }

    if (targets.style) {
      if (!dryRun) {
        await fs.mkdir(getDesignDir(projectRoot), { recursive: true });
        await fs.writeFile(
          getDesignStylePath(projectRoot),
          ingested.style || "# Design style\n",
          "utf-8"
        );
      }
      reindexedIds.add("style");
    }

    const componentsToWrite: DesignComponentCard[] = targets.allComponents
      ? ingested.components
      : ingested.components.filter((c) => targets.componentIds.has(c.id));

    for (const card of componentsToWrite) {
      assertDesignId(card.id, "component");
      await writeJson(
        path.join(getDesignComponentsDir(projectRoot), `${card.id}.json`),
        card,
        dryRun
      );
      componentsWritten++;
      reindexedIds.add(card.id);
    }
  }

  if (targets.pages || pagesOnly) {
    for (const page of ingested.pages) {
      assertDesignId(page.id, "page");
      await writeJson(
        path.join(getDesignPagesDir(projectRoot), `${page.id}.json`),
        page,
        dryRun
      );
      pagesWritten++;
      reindexedIds.add(page.id);
    }
  }

  if (targets.refs || pagesOnly) {
    const sourceAbs = path.resolve(projectRoot, sourceRel);
    const meta = await readBaoyuMeta(sourceAbs);
    const refs = await collectRefFiles(projectRoot, sourceAbs, meta);
    const refsDir = getDesignRefsDir(projectRoot);
    for (const ref of refs) {
      try {
        await fs.access(ref.absPath);
        await copyRef(ref.absPath, refsDir, ref.name, dryRun);
      } catch {
        profile.warnings.push(`Missing ref file: ${ref.absPath}`);
      }
    }
  }

  if (!dryRun) {
    await writeJson(getDesignProfilePath(projectRoot), profile, false);
    await writeIngestState(
      projectRoot,
      { version: 1, sourceRel, syncedAt, files: currentFiles },
      false
    );

    const ids = [...reindexedIds];
    if (ids.length > 0) {
      const indexResult = await reindexDesignIds(projectRoot, ids);
      if (indexResult.warning) {
        profile.warnings.push(indexResult.warning);
        await writeJson(getDesignProfilePath(projectRoot), profile, false);
      }
    }
  }

  return {
    profile,
    componentsWritten,
    pagesWritten,
    tokenFiles,
    warnings: profile.warnings,
    dryRun,
    incremental: true,
    changedFiles: changes.all,
    reindexedIds: [...reindexedIds],
  };
}
