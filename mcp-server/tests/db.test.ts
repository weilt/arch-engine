import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  readDb,
  writeDb,
  appendContract,
  appendMissing,
} from "../src/db.js";

describe("db", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "apt-test-"));
    await fs.mkdir(path.join(tmpDir, ".ai"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("readDb throws if db missing", async () => {
    await expect(readDb(tmpDir)).rejects.toThrow(/not found/i);
  });

  it("readDb throws if db schema is invalid", async () => {
    await fs.writeFile(
      path.join(tmpDir, ".ai", "db.json"),
      JSON.stringify({ contracts: "bad" }),
      "utf-8"
    );
    await expect(readDb(tmpDir)).rejects.toThrow(/Invalid db.json/i);
  });

  it("writeDb and readDb roundtrip", async () => {
    const db = { contracts: [], missingRequests: [] };
    await writeDb(tmpDir, db);
    const loaded = await readDb(tmpDir);
    expect(loaded).toEqual(db);
  });

  it("appendContract rejects duplicate name", async () => {
    await writeDb(tmpDir, { contracts: [], missingRequests: [] });
    await appendContract(tmpDir, {
      name: "Foo",
      description: "d",
      tsFilePath: "a.ts",
      registeredAt: new Date().toISOString(),
    });
    await expect(
      appendContract(tmpDir, {
        name: "Foo",
        description: "d2",
        tsFilePath: "b.ts",
        registeredAt: new Date().toISOString(),
      })
    ).rejects.toThrow(/already exists/i);
  });

  it("appendMissing adds record", async () => {
    await writeDb(tmpDir, { contracts: [], missingRequests: [] });
    await appendMissing(tmpDir, {
      missingName: "Bar",
      reason: "needed",
      reportedAt: new Date().toISOString(),
    });
    const db = await readDb(tmpDir);
    expect(db.missingRequests).toHaveLength(1);
    expect(db.missingRequests[0].missingName).toBe("Bar");
  });
});
