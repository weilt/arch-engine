import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MissingDesignProfileError, runDesignSync } from "@apt/arch-engine";
import { handleAuditDesignChanges } from "../src/design-audit.js";

async function writeMinimalDesign(projectRoot: string): Promise<void> {
  const dsDir = path.join(projectRoot, "designs", "mcp-audit-ds");
  await fs.mkdir(path.join(dsDir, "components"), { recursive: true });
  await fs.writeFile(path.join(dsDir, "styles.css"), ":root { --colorPrimary: #3366ff; }\n");
  await fs.writeFile(
    path.join(dsDir, "_ds_manifest.json"),
    JSON.stringify({ namespace: "McpAuditDS", components: ["PrimaryButton"] })
  );
  await fs.writeFile(path.join(dsDir, "_ds_prompt.md"), "MCP audit fixture.");
  await fs.writeFile(
    path.join(dsDir, "components", "PrimaryButton.prompt.md"),
    "# PrimaryButton\n\nMain CTA.\n"
  );
  await runDesignSync(projectRoot, { source: "designs/mcp-audit-ds" });
}

describe("handleAuditDesignChanges", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-design-audit-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns structured audit JSON for a synced design profile", async () => {
    await writeMinimalDesign(tmpRoot);

    const result = await handleAuditDesignChanges(tmpRoot);
    expect(result.ok).toBe(true);
    expect(result.profile.primarySource).toBe("designs/mcp-audit-ds");
    expect(Array.isArray(result.stale)).toBe(true);
    expect(Array.isArray(result.missing_bindings)).toBe(true);
    expect(Array.isArray(result.page_gaps)).toBe(true);
    expect(Array.isArray(result.undeclared_implementations)).toBe(true);
    expect(Array.isArray(result.token_violations)).toBe(true);
  });

  it("forwards sourcePaths to token violation scan", async () => {
    await writeMinimalDesign(tmpRoot);
    await fs.mkdir(path.join(tmpRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, "src", "App.vue"), '<style>.x { margin: 8px; color: #abc; }</style>\n');

    const result = await handleAuditDesignChanges(tmpRoot, { sourcePaths: ["src/App.vue"] });
    expect(result.token_violations.length).toBeGreaterThan(0);
  });

  it("propagates MissingDesignProfileError when profile is absent", async () => {
    await expect(handleAuditDesignChanges(tmpRoot)).rejects.toThrow(MissingDesignProfileError);
  });
});
