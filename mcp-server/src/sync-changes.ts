import {
  runSyncChanges,
  type SyncChangesOptions,
  type SyncChangesReport,
} from "@apt/arch-engine";

export async function handleSyncArchChanges(
  projectRoot: string,
  options: SyncChangesOptions = {}
): Promise<SyncChangesReport> {
  return runSyncChanges(projectRoot, options);
}
