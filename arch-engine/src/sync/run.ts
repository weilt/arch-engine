import { auditArchChanges, type AuditArchChangesResult } from "../audit/changes.js";
import { refreshLastScanFileHashes } from "../incremental/refresh-file-hashes.js";
import { removeAssetFromArch } from "../remove/asset.js";
import {
  refreshAssetInArch,
  type RefreshAssetDeps,
  type RefreshAssetResult,
} from "../refresh/asset.js";

export interface SyncChangesOptions {
  dryRun?: boolean;
  since?: string;
  paths?: string[];
}

export interface SyncChangesReport {
  audit: AuditArchChangesResult;
  refreshed: RefreshAssetResult[];
  removed: { assetId: string; sourcePath?: string }[];
  errors: { sourcePath?: string; assetId?: string; message: string }[];
}

export async function runSyncChanges(
  projectRoot: string,
  options: SyncChangesOptions = {},
  deps: RefreshAssetDeps = {}
): Promise<SyncChangesReport> {
  const audit = await auditArchChanges(projectRoot, {
    since: options.since,
    paths: options.paths,
  });
  const report: SyncChangesReport = {
    audit,
    refreshed: [],
    removed: [],
    errors: [],
  };
  if (options.dryRun) return report;

  const toRefresh = [...audit.modified, ...audit.unregistered, ...audit.new];
  for (const item of toRefresh) {
    try {
      const r = await refreshAssetInArch(
        projectRoot,
        {
          sourcePath: item.sourcePath,
          kind: item.suggestedKind,
          name: item.suggestedName,
          module: item.module,
        },
        deps
      );
      report.refreshed.push(r);
    } catch (e) {
      report.errors.push({ sourcePath: item.sourcePath, message: String(e) });
    }
  }

  for (const item of audit.deleted) {
    if (!item.assetId) continue;
    try {
      await removeAssetFromArch(projectRoot, {
        assetId: item.assetId,
        sourcePath: item.sourcePath,
      });
      report.removed.push({ assetId: item.assetId, sourcePath: item.sourcePath });
    } catch (e) {
      report.errors.push({ assetId: item.assetId, message: String(e) });
    }
  }

  if (report.errors.length === 0 && audit.anchor.mode === "fileHashes") {
    await refreshLastScanFileHashes(projectRoot);
  }

  return report;
}
