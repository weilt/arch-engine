import { collectTrackedSourceHashes } from "./file-hashes.js";
import { readLastScan, writeLastScan } from "./last-scan.js";
import type { LastScanState } from "../types.js";

/** Re-snapshot tracked source file hashes in last-scan.json (nogit anchor refresh). */
export async function refreshLastScanFileHashes(
  projectRoot: string,
  last?: LastScanState | null
): Promise<void> {
  const state = last ?? (await readLastScan(projectRoot));
  if (!state) return;

  const modules = Object.entries(state.modules).map(([slug, e]) => ({
    slug,
    path: e.sourcePath,
  }));
  const packages = Object.keys(state.packages).map((slug) => ({ slug }));
  const packageDirs = new Map(
    Object.entries(state.packages).map(([slug, e]) => [slug, e.sourcePath])
  );

  const current = await collectTrackedSourceHashes(
    projectRoot,
    modules,
    packages,
    packageDirs
  );

  const updated: LastScanState = {
    ...state,
    modules: { ...state.modules },
    packages: { ...state.packages },
  };

  for (const slug of Object.keys(state.modules)) {
    const entry = updated.modules[slug]!;
    updated.modules[slug] = {
      ...entry,
      fileHashes: current[slug] ?? {},
    };
  }
  for (const slug of Object.keys(state.packages)) {
    const entry = updated.packages[slug]!;
    updated.packages[slug] = {
      ...entry,
      fileHashes: current[slug] ?? {},
    };
  }

  await writeLastScan(projectRoot, updated);
}
