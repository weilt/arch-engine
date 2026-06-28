import { describe, it, expect, beforeEach, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { runCliStatus } from "../src/cli-status.js";

// Smoke test: runCliStatus --json against an empty tmp project root must emit
// parseable JSON carrying the contract `phase` field. getProjectRoot honors
// APT_PROJECT_ROOT, so we point it at an empty dir (phase resolves to blocked
// because no .ai/db.json exists) without touching the real repo.
describe("apt-status CLI (cli-status)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apt-status-"));
    process.env.APT_PROJECT_ROOT = tmpRoot;
  });

  it("--json prints parseable status with a phase field", async () => {
    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((data) => {
        chunks.push(typeof data === "string" ? data : data.toString());
        return true;
      });

    const code = await runCliStatus(["--json"]);

    spy.mockRestore();
    expect(code).toBe(0);
    const parsed = JSON.parse(chunks.join(""));
    expect(parsed).toHaveProperty("phase");
  });
});
