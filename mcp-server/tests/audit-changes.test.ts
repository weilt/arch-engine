import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeLastScan, MissingLastScanError } from "@apt/arch-engine";
import { handleAuditArchChanges } from "../src/audit-changes.js";

describe("handleAuditArchChanges", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-audit-"));
    await fs.mkdir(path.join(tmpRoot, ".ai", "arch"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, "demo", "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, "demo", "src", "FooUtils.java"),
      "public class FooUtils {}",
      "utf-8"
    );
    await writeLastScan(tmpRoot, {
      version: 2,
      commit: "nogit",
      branch: "nogit",
      scannedAt: "2026-06-16T00:00:00.000Z",
      modules: {
        demo: { sourcePath: "demo", assetCount: 0, fileHashes: {} },
      },
      packages: {},
    });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns audit JSON with unregistered util", async () => {
    const result = await handleAuditArchChanges(tmpRoot);
    expect(result.anchor.mode).toBe("fileHashes");
    expect(
      result.unregistered.some((i) => i.sourcePath === "demo/src/FooUtils.java")
    ).toBe(true);
  });

  it("propagates MissingLastScanError when anchor is absent", async () => {
    const bare = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-audit-bare-"));
    try {
      await fs.mkdir(path.join(bare, ".ai", "arch"), { recursive: true });
      await expect(handleAuditArchChanges(bare)).rejects.toThrow(MissingLastScanError);
    } finally {
      await fs.rm(bare, { recursive: true, force: true });
    }
  });
});
