import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { appendContract, findContract, readDb } from "../dist/db.js";
import { regenerateIndexMd } from "../dist/index-md.js";

describe("integration", () => {
  it("registers contract and regenerates INDEX.md", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "apt-integration-"));

    try {
      await fs.mkdir(path.join(tmpDir, ".ai"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, ".ai", "db.json"),
        JSON.stringify({ contracts: [], missingRequests: [] }, null, 2)
      );
      await fs.mkdir(path.join(tmpDir, "src/contracts"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, "src/contracts/demo.ts"),
        "export interface DemoContract { id: string; }\n"
      );

      await appendContract(tmpDir, {
        name: "Demo",
        description: "demo contract",
        tsFilePath: "src/contracts/demo.ts",
        registeredAt: new Date().toISOString(),
      });
      await regenerateIndexMd(tmpDir);

      const db = await readDb(tmpDir);
      const contract = findContract(db, "Demo");
      const index = await fs.readFile(path.join(tmpDir, ".ai", "INDEX.md"), "utf-8");

      expect(contract).toBeDefined();
      expect(index).toContain("Demo");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
