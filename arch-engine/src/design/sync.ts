import fs from "node:fs/promises";
import path from "node:path";
import {
  collectRefFiles,
  ingestBaoyuSource,
  readBaoyuMeta,
} from "./ingest/baoyu.js";
import { ingestFigmaSource } from "./ingest/figma.js";
import { ingestHtmlSource } from "./ingest/html.js";
import { discoverV0PageSourceDirs, ingestV0Source } from "./ingest/v0.js";
import {
  getDesignComponentsDir,
  getDesignDir,
  getDesignLogicDir,
  getDesignPagesDir,
  getDesignRefsDir,
  getDesignStylePath,
  getDesignTokensDir,
  getDesignProfilePath,
} from "./paths.js";
import { assertDesignId } from "./ids.js";
import type { DesignProfile, DesignSyncOptions, DesignSyncReport } from "./types.js";
import { indexDesignKnowledge } from "./vectors.js";
import { runIncrementalDesignSync, snapshotSourceFiles, writeIngestState } from "./incremental.js";

async function writeJson(filePath: string, data: unknown, dryRun: boolean): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  if (dryRun) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf-8");
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

async function readExistingProfile(projectRoot: string): Promise<DesignProfile | null> {
  try {
    return JSON.parse(
      await fs.readFile(getDesignProfilePath(projectRoot), "utf-8")
    ) as DesignProfile;
  } catch {
    return null;
  }
}

async function runHtmlDesignSync(
  projectRoot: string,
  options: DesignSyncOptions
): Promise<DesignSyncReport> {
  const dryRun = options.dryRun ?? false;
  const sourceRel = options.source;
  if (!sourceRel) {
    throw new Error("HTML adapter requires --source path/to/page.html");
  }

  const ingested = await ingestHtmlSource(projectRoot, sourceRel);
  const syncedAt = new Date().toISOString();
  const existingProfile = await readExistingProfile(projectRoot);
  const pagePath = path.join(getDesignPagesDir(projectRoot), `${ingested.page.id}.json`);
  const pageExisted = await fs
    .access(pagePath)
    .then(() => true)
    .catch(() => false);

  let pageCount = existingProfile?.pageCount ?? 0;
  if (!pageExisted) {
    pageCount += 1;
  } else if (!existingProfile) {
    pageCount = 1;
  }

  const profile: DesignProfile = existingProfile
    ? {
        ...existingProfile,
        syncedAt,
        pageCount,
        warnings: [...new Set([...existingProfile.warnings, ...ingested.warnings])],
        sourceMtimeMs: ingested.sourceMtimeMs,
      }
    : {
        ...ingested.profile,
        syncedAt,
        componentCount: 0,
        pageCount: 1,
        warnings: ingested.warnings,
      };

  assertDesignId(ingested.page.id, "page");
  await writeJson(pagePath, ingested.page, dryRun);
  await copyRef(
    ingested.refFile.absPath,
    getDesignRefsDir(projectRoot),
    ingested.refFile.name,
    dryRun
  );

  if (!dryRun) {
    await fs.mkdir(getDesignDir(projectRoot), { recursive: true });
    await writeJson(getDesignProfilePath(projectRoot), profile, false);

    const indexResult = await indexDesignKnowledge(projectRoot);
    if (indexResult.warning) {
      profile.warnings.push(indexResult.warning);
      await writeJson(getDesignProfilePath(projectRoot), profile, false);
    }
  }

  return {
    profile,
    componentsWritten: 0,
    pagesWritten: 1,
    tokenFiles: [],
    warnings: profile.warnings,
    dryRun,
  };
}

async function runFigmaDesignSync(
  projectRoot: string,
  options: DesignSyncOptions
): Promise<DesignSyncReport> {
  const dryRun = options.dryRun ?? false;
  const sourceRel = options.source;
  if (!sourceRel) {
    throw new Error(
      "Figma adapter requires --source path/to/figma-export.json or a fileKey with FIGMA_ACCESS_TOKEN"
    );
  }

  const ingested = await ingestFigmaSource(projectRoot, sourceRel);
  const designDir = getDesignDir(projectRoot);
  const syncedAt = new Date().toISOString();

  const profile: DesignProfile = {
    ...ingested.profile,
    syncedAt,
    componentCount: ingested.components.length,
    pageCount: 0,
    warnings: ingested.warnings,
    sourceMtimeMs: ingested.sourceMtimeMs,
  };

  const tokenFiles: string[] = [];

  await writeJson(getDesignProfilePath(projectRoot), profile, dryRun);
  if (!dryRun) {
    await fs.mkdir(designDir, { recursive: true });
  }

  for (const [bucket, values] of Object.entries(ingested.tokens)) {
    if (Object.keys(values).length === 0) continue;
    const fileName = `${bucket}.json`;
    tokenFiles.push(fileName);
    await writeJson(path.join(getDesignTokensDir(projectRoot), fileName), values, dryRun);
  }

  for (const card of ingested.components) {
    assertDesignId(card.id, "component");
    await writeJson(
      path.join(getDesignComponentsDir(projectRoot), `${card.id}.json`),
      card,
      dryRun
    );
  }

  if (ingested.refFile) {
    await copyRef(
      ingested.refFile.absPath,
      getDesignRefsDir(projectRoot),
      ingested.refFile.name,
      dryRun
    );
  }

  if (!dryRun) {
    await writeJson(getDesignProfilePath(projectRoot), profile, false);

    const indexResult = await indexDesignKnowledge(projectRoot);
    if (indexResult.warning) {
      profile.warnings.push(indexResult.warning);
      await writeJson(getDesignProfilePath(projectRoot), profile, false);
    }
  }

  return {
    profile,
    componentsWritten: ingested.components.length,
    pagesWritten: 0,
    tokenFiles,
    warnings: profile.warnings,
    dryRun,
  };
}

async function runV0DesignSync(
  projectRoot: string,
  options: DesignSyncOptions
): Promise<DesignSyncReport> {
  const dryRun = options.dryRun ?? false;
  const sourceRel = options.source ?? "designs/v0";
  const pageDirs = await discoverV0PageSourceDirs(projectRoot, sourceRel);
  const syncedAt = new Date().toISOString();
  const existingProfile = await readExistingProfile(projectRoot);

  let pageCount = existingProfile?.pageCount ?? 0;
  const existingPageIds = new Set<string>();
  if (existingProfile) {
    try {
      const entries = await fs.readdir(getDesignPagesDir(projectRoot));
      for (const e of entries) {
        if (e.endsWith(".json")) existingPageIds.add(e.replace(/\.json$/, ""));
      }
    } catch {
      // no pages dir yet
    }
    pageCount = existingPageIds.size;
  }

  const allWarnings: string[] = [...(existingProfile?.warnings ?? [])];
  let pagesWritten = 0;
  let maxSourceMtime = existingProfile?.sourceMtimeMs ?? 0;
  const mergedSources = [...(existingProfile?.sources ?? [])];
  let primarySource = existingProfile?.primarySource ?? {
    tool: "v0",
    path: sourceRel,
  };

  for (const pageDirRel of pageDirs) {
    const ingested = await ingestV0Source(projectRoot, pageDirRel);
    allWarnings.push(...ingested.warnings);

    const pagePath = path.join(getDesignPagesDir(projectRoot), `${ingested.page.id}.json`);
    const pageExisted = existingPageIds.has(ingested.page.id);

    assertDesignId(ingested.page.id, "page");
    await writeJson(pagePath, ingested.page, dryRun);

    if (!dryRun) {
      const logicDir = getDesignLogicDir(projectRoot);
      await fs.mkdir(logicDir, { recursive: true });
      await fs.copyFile(
        ingested.logicAbsPath,
        path.join(logicDir, `${ingested.page.id}.md`),
      );
    }

    const refsDir = getDesignRefsDir(projectRoot);
    for (const ref of ingested.refFiles) {
      await copyRef(ref.absPath, refsDir, ref.name, dryRun);
    }

    if (!pageExisted) {
      pageCount += 1;
      existingPageIds.add(ingested.page.id);
    }
    pagesWritten += 1;
    maxSourceMtime = Math.max(maxSourceMtime, ingested.sourceMtimeMs);

    const sourceEntry = { tool: "v0", path: pageDirRel, role: "page" };
    if (!mergedSources.some((s) => s.tool === "v0" && s.path === pageDirRel)) {
      mergedSources.push(sourceEntry);
    }
    primarySource = { tool: "v0", path: sourceRel };
  }

  const profile: DesignProfile = existingProfile
    ? {
        ...existingProfile,
        primarySource,
        sources: mergedSources,
        syncedAt,
        pageCount,
        warnings: [...new Set(allWarnings)],
        sourceMtimeMs: maxSourceMtime,
      }
    : {
        version: 1,
        primarySource,
        sources: mergedSources,
        syncedAt,
        componentCount: 0,
        pageCount,
        warnings: [...new Set(allWarnings)],
        sourceMtimeMs: maxSourceMtime,
      };

  if (!dryRun) {
    await fs.mkdir(getDesignDir(projectRoot), { recursive: true });
    await writeJson(getDesignProfilePath(projectRoot), profile, false);

    const indexResult = await indexDesignKnowledge(projectRoot);
    if (indexResult.warning) {
      profile.warnings.push(indexResult.warning);
      await writeJson(getDesignProfilePath(projectRoot), profile, false);
    }
  }

  return {
    profile,
    componentsWritten: 0,
    pagesWritten,
    tokenFiles: [],
    warnings: profile.warnings,
    dryRun,
  };
}

export async function runDesignSync(
  projectRoot: string,
  options: DesignSyncOptions = {}
): Promise<DesignSyncReport> {
  if (options.adapter === "html") {
    return runHtmlDesignSync(projectRoot, options);
  }

  if (options.adapter === "figma") {
    return runFigmaDesignSync(projectRoot, options);
  }

  if (options.adapter === "v0") {
    return runV0DesignSync(projectRoot, options);
  }

  if (options.incremental) {
    return runIncrementalDesignSync(projectRoot, options);
  }

  const dryRun = options.dryRun ?? false;
  const pagesOnly = options.pagesOnly ?? false;
  const sourceRel = options.source ?? "designs";

  const ingested = await ingestBaoyuSource(projectRoot, sourceRel);
  const designDir = getDesignDir(projectRoot);
  const syncedAt = new Date().toISOString();

  const profile: DesignProfile = {
    ...ingested.profile,
    syncedAt,
    componentCount: ingested.components.length,
    pageCount: ingested.pages.length,
    warnings: ingested.warnings,
    sourceMtimeMs: ingested.sourceMtimeMs,
  };

  const tokenFiles: string[] = [];

  if (!pagesOnly) {
    await writeJson(getDesignProfilePath(projectRoot), profile, dryRun);
    if (!dryRun) {
      await fs.mkdir(designDir, { recursive: true });
      await fs.writeFile(
        getDesignStylePath(projectRoot),
        ingested.style || "# Design style\n",
        "utf-8"
      );
    }

    for (const [bucket, values] of Object.entries(ingested.tokens)) {
      if (Object.keys(values).length === 0) continue;
      const fileName = `${bucket}.json`;
      tokenFiles.push(fileName);
      await writeJson(path.join(getDesignTokensDir(projectRoot), fileName), values, dryRun);
    }

    for (const card of ingested.components) {
      assertDesignId(card.id, "component");
      await writeJson(
        path.join(getDesignComponentsDir(projectRoot), `${card.id}.json`),
        card,
        dryRun
      );
    }
  } else if (!dryRun) {
    try {
      const existing = JSON.parse(
        await fs.readFile(getDesignProfilePath(projectRoot), "utf-8")
      ) as DesignProfile;
      existing.pageCount = ingested.pages.length;
      existing.syncedAt = syncedAt;
      existing.warnings = [...new Set([...existing.warnings, ...ingested.warnings])];
      await writeJson(getDesignProfilePath(projectRoot), existing, false);
      Object.assign(profile, existing);
    } catch {
      throw new Error("pages-only sync requires an existing .ai/design/profile.json");
    }
  }

  const sourceAbs = path.resolve(projectRoot, sourceRel);
  const meta = await readBaoyuMeta(sourceAbs);
  const refs = await collectRefFiles(projectRoot, sourceAbs, meta);
  const refsDir = getDesignRefsDir(projectRoot);

  for (const page of ingested.pages) {
    assertDesignId(page.id, "page");
    await writeJson(path.join(getDesignPagesDir(projectRoot), `${page.id}.json`), page, dryRun);
  }

  for (const ref of refs) {
    try {
      await fs.access(ref.absPath);
      await copyRef(ref.absPath, refsDir, ref.name, dryRun);
    } catch {
      profile.warnings.push(`Missing ref file: ${ref.absPath}`);
    }
  }

  if (!dryRun && !pagesOnly) {
    await writeJson(getDesignProfilePath(projectRoot), profile, false);
  }

  if (!dryRun) {
    const indexResult = await indexDesignKnowledge(projectRoot);
    if (indexResult.warning) {
      profile.warnings.push(indexResult.warning);
      if (!pagesOnly) {
        await writeJson(getDesignProfilePath(projectRoot), profile, false);
      }
    }

    const fileSnapshot = await snapshotSourceFiles(projectRoot, sourceRel);
    await writeIngestState(
      projectRoot,
      { version: 1, sourceRel, syncedAt, files: fileSnapshot },
      false
    );
  }

  return {
    profile,
    componentsWritten: ingested.components.length,
    pagesWritten: ingested.pages.length,
    tokenFiles,
    warnings: profile.warnings,
    dryRun,
  };
}
