import fs from "node:fs/promises";
import path from "node:path";
import {
  collectRefFiles,
  ingestBaoyuSource,
  readBaoyuMeta,
} from "./ingest/baoyu.js";
import { ingestHtmlSource } from "./ingest/html.js";
import {
  getDesignComponentsDir,
  getDesignDir,
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

export async function runDesignSync(
  projectRoot: string,
  options: DesignSyncOptions = {}
): Promise<DesignSyncReport> {
  if (options.adapter === "html") {
    return runHtmlDesignSync(projectRoot, options);
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
