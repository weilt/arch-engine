import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLastScan, writeLastScan } from "../../src/incremental/last-scan.js";
import { getLastScanPath } from "../../src/paths.js";
import type { LastScanState } from "../../src/types.js";

const sampleState: LastScanState = {
  version: 2,
  commit: "abc123def456",
  branch: "main",
  scannedAt: "2026-06-02T12:00:00.000Z",
  modules: {
    "base-common": {
      sourcePath: "base/base-framework/base-common",
      assetCount: 52,
      fileHashes: {},
    },
  },
  packages: {
    ui: {
      sourcePath: "packages/ui",
      assetCount: 8,
      fileHashes: {},
    },
  },
};

describe("last-scan", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "last-scan-"));
    await fs.mkdir(path.join(tmpRoot, ".ai", "arch"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns null when last-scan.json is missing", async () => {
    expect(await readLastScan(tmpRoot)).toBeNull();
  });

  it("round-trips LastScanState per spec §8.2", async () => {
    await writeLastScan(tmpRoot, sampleState);
    const raw = await fs.readFile(getLastScanPath(tmpRoot), "utf-8");
    const parsed = JSON.parse(raw) as LastScanState;

    expect(parsed.version).toBe(2);
    expect(parsed.commit).toBe("abc123def456");
    expect(parsed.modules["base-common"]?.assetCount).toBe(52);

    expect(await readLastScan(tmpRoot)).toEqual(sampleState);
  });
});
