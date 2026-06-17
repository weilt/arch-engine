import fs from "node:fs/promises";
import path from "node:path";
import { shouldIgnoreAuditPath } from "./ignore.js";
import { mapFileToCandidate } from "../discovery/map-file.js";
import { collectTrackedSourceHashes } from "../incremental/file-hashes.js";
import {
  getChangedFilesSince,
  getCurrentCommit,
  isGitRepo,
} from "../incremental/git-diff.js";
import { readLastScan } from "../incremental/last-scan.js";
import { getVectorsDbPath } from "../paths.js";
import type { AssetKind, LastScanState } from "../types.js";
import { VectorStore } from "../vector/sqlite-store.js";

export interface AuditItem {
  sourcePath: string;
  assetId?: string;
  suggestedKind?: AssetKind;
  suggestedName?: string;
  module?: string;
  reason?: string;
}

export interface AuditArchChangesResult {
  anchor: { commit: string; scannedAt?: string; mode: "git" | "fileHashes" };
  new: AuditItem[];
  modified: AuditItem[];
  deleted: AuditItem[];
  unregistered: AuditItem[];
}

export interface AuditArchChangesOptions {
  since?: string;
  paths?: string[];
}

export class MissingLastScanError extends Error {
  constructor() {
    super(
      "No last-scan.json anchor found. Run start-init before audit_arch_changes or sync-changes."
    );
    this.name = "MissingLastScanError";
  }
}

function moduleSlugForPath(last: LastScanState, relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  for (const [slug, entry] of Object.entries(last.modules)) {
    const prefix = entry.sourcePath.replace(/\\/g, "/");
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return slug;
    }
  }
  for (const [slug, entry] of Object.entries(last.packages)) {
    const prefix = entry.sourcePath.replace(/\\/g, "/");
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return slug;
    }
  }
  const first = normalized.split("/")[0];
  return first ?? "unknown";
}

function applyPathsFilter(changed: Set<string>, paths?: string[]): void {
  if (!paths?.length) return;
  const allow = new Set(paths.map((p) => p.replace(/\\/g, "/")));
  for (const f of [...changed]) {
    if (!allow.has(f)) changed.delete(f);
  }
}

async function collectNogitChangedFiles(
  projectRoot: string,
  last: LastScanState
): Promise<Set<string>> {
  const changed = new Set<string>();
  const modules = Object.entries(last.modules).map(([slug, e]) => ({
    slug,
    path: e.sourcePath,
  }));
  const packages = Object.keys(last.packages).map((slug) => ({ slug }));
  const packageDirs = new Map(
    Object.entries(last.packages).map(([slug, e]) => [slug, e.sourcePath])
  );

  const current = await collectTrackedSourceHashes(
    projectRoot,
    modules,
    packages,
    packageDirs
  );

  const allModuleSlugs = Object.keys(last.modules);
  const allPackageSlugs = Object.keys(last.packages);

  for (const slug of allModuleSlugs) {
    const oldHashes = last.modules[slug]?.fileHashes ?? {};
    const newHashes = current[slug] ?? {};
    diffHashes(oldHashes, newHashes, changed);
  }
  for (const slug of allPackageSlugs) {
    const oldHashes = last.packages[slug]?.fileHashes ?? {};
    const newHashes = current[slug] ?? {};
    diffHashes(oldHashes, newHashes, changed);
  }

  return changed;
}

function diffHashes(
  oldHashes: Record<string, string>,
  newHashes: Record<string, string>,
  changed: Set<string>
): void {
  const oldPaths = new Set(Object.keys(oldHashes));
  const newPaths = new Set(Object.keys(newHashes));

  for (const rel of newPaths) {
    if (shouldIgnoreAuditPath(rel)) continue;
    if (!oldPaths.has(rel) || oldHashes[rel] !== newHashes[rel]) {
      changed.add(rel);
    }
  }
  for (const rel of oldPaths) {
    if (shouldIgnoreAuditPath(rel)) continue;
    if (!newPaths.has(rel)) {
      changed.add(rel);
    }
  }
}

async function classifyChangedFile(
  projectRoot: string,
  store: VectorStore,
  last: LastScanState | null,
  rel: string
): Promise<{ bucket: "modified" | "unregistered" | "new"; item: AuditItem } | null> {
  const moduleSlug = last ? moduleSlugForPath(last, rel) : rel.split("/")[0] ?? "unknown";
  let exists = true;
  try {
    await fs.access(path.join(projectRoot, rel));
  } catch {
    exists = false;
  }

  if (!exists) {
    return null;
  }

  const candidate = await mapFileToCandidate(projectRoot, rel, moduleSlug);
  const assetIds = store.assetIdsBySourcePath(rel);
  const item: AuditItem = {
    sourcePath: rel,
    assetId: assetIds[0],
    suggestedKind: candidate?.kind,
    suggestedName: candidate?.name,
    module: candidate?.moduleSlug ?? moduleSlug,
  };

  if (assetIds.length > 0) {
    return {
      bucket: "modified",
      item: { ...item, reason: "source changed since anchor" },
    };
  }
  if (candidate) {
    return {
      bucket: "unregistered",
      item: { ...item, reason: "discoverable asset not in index" },
    };
  }
  return null;
}

export async function auditArchChanges(
  projectRoot: string,
  options: AuditArchChangesOptions = {}
): Promise<AuditArchChangesResult> {
  const last = await readLastScan(projectRoot);
  if (!last) {
    throw new MissingLastScanError();
  }
  const useGit =
    Boolean(last?.commit && last.commit !== "nogit") && isGitRepo(projectRoot);
  const changedFiles = new Set<string>();

  if (useGit && last) {
    const since =
      options.since && options.since !== "last-scan" ? options.since : last.commit;
    for (const f of getChangedFilesSince(projectRoot, since)) {
      if (!shouldIgnoreAuditPath(f)) changedFiles.add(f);
    }
  } else if (last) {
    for (const f of await collectNogitChangedFiles(projectRoot, last)) {
      changedFiles.add(f);
    }
  }

  applyPathsFilter(changedFiles, options.paths);

  const result: AuditArchChangesResult = {
    anchor: {
      commit: last?.commit ?? getCurrentCommit(projectRoot),
      scannedAt: last?.scannedAt,
      mode: useGit ? "git" : "fileHashes",
    },
    new: [],
    modified: [],
    deleted: [],
    unregistered: [],
  };

  const store = new VectorStore(getVectorsDbPath(projectRoot));
  try {
    const seenModified = new Set<string>();
    const seenUnregistered = new Set<string>();

    for (const rel of changedFiles) {
      let exists = true;
      try {
        await fs.access(path.join(projectRoot, rel));
      } catch {
        exists = false;
      }

      if (!exists) continue;

      const classified = await classifyChangedFile(projectRoot, store, last, rel);
      if (!classified) continue;
      if (classified.bucket === "modified" && !seenModified.has(rel)) {
        seenModified.add(rel);
        result.modified.push(classified.item);
      } else if (classified.bucket === "unregistered" && !seenUnregistered.has(rel)) {
        seenUnregistered.add(rel);
        result.unregistered.push(classified.item);
      }
    }

    for (const rel of store.listSourcePaths()) {
      if (shouldIgnoreAuditPath(rel)) continue;
      try {
        await fs.access(path.join(projectRoot, rel));
      } catch {
        for (const assetId of store.assetIdsBySourcePath(rel)) {
          result.deleted.push({
            sourcePath: rel,
            assetId,
            reason: "source file removed",
          });
        }
      }
    }
  } finally {
    store.close();
  }

  return result;
}
