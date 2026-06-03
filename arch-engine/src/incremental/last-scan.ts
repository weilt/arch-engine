import fs from "node:fs/promises";
import { getLastScanPath } from "../paths.js";
import type { LastScanState } from "../types.js";

export async function readLastScan(projectRoot: string): Promise<LastScanState | null> {
  try {
    const raw = await fs.readFile(getLastScanPath(projectRoot), "utf-8");
    const parsed = JSON.parse(raw) as Partial<LastScanState>;
    if (parsed.version !== 2) {
      return null;
    }
    return parsed as LastScanState;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw e;
  }
}

export async function writeLastScan(
  projectRoot: string,
  state: LastScanState
): Promise<void> {
  await fs.writeFile(getLastScanPath(projectRoot), JSON.stringify(state, null, 2), "utf-8");
}
