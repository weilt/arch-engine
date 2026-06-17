import { handleQueryDesign } from "../src/design-query.js";
import { handleSearchUi } from "../src/design-search.js";
import { handleReportDesignGap } from "../src/design-gap.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDesignSync, MissingDesignProfileError } from "@apt/arch-engine";

async function seedDesign(tmpRoot: string): Promise<void> {
  const dsDir = path.join(tmpRoot, "designs", "ui-ds");
  await fs.mkdir(path.join(dsDir, "components"), { recursive: true });
  await fs.writeFile(path.join(dsDir, "styles.css"), ":root { --colorPrimary: #00f; }\n");
  await fs.writeFile(
    path.join(dsDir, "_ds_manifest.json"),
    JSON.stringify({ namespace: "UiDS", components: ["PrimaryButton"] })
  );
  await fs.writeFile(path.join(dsDir, "_ds_prompt.md"), "Use blue primary.");
  await fs.writeFile(
    path.join(dsDir, "components", "PrimaryButton.prompt.md"),
    "# PrimaryButton\n\nMain CTA.\n"
  );
  await runDesignSync(tmpRoot, { source: "designs/ui-ds" });
}

describe("design MCP handlers", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-design-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("query_design global returns tokens", async () => {
    await seedDesign(tmpRoot);
    const result = await handleQueryDesign(tmpRoot, { scope: "global" });
    expect(result.kind).toBe("global");
  });

  it("search_ui finds component", async () => {
    await seedDesign(tmpRoot);
    const hits = await handleSearchUi(tmpRoot, { query: "Primary" });
    expect(hits.some((h) => h.id === "PrimaryButton")).toBe(true);
  });

  it("throws MissingDesignProfileError without profile", async () => {
    await expect(handleQueryDesign(tmpRoot, { scope: "global" })).rejects.toThrow(
      MissingDesignProfileError
    );
  });

  it("report_design_gap appends to gaps.json", async () => {
    await seedDesign(tmpRoot);
    const msg = await handleReportDesignGap(tmpRoot, {
      need: "EmptyState",
      reason: "settings page needs empty state",
      page: "user-settings",
    });
    expect(msg).toContain("BLOCKED");
    const gaps = JSON.parse(
      await fs.readFile(path.join(tmpRoot, ".ai", "design", "gaps.json"), "utf-8")
    );
    expect(gaps).toHaveLength(1);
  });

  it("rejects conflicting query_design parameters", async () => {
    await seedDesign(tmpRoot);
    await expect(
      handleQueryDesign(tmpRoot, { scope: "global", page: "home" })
    ).rejects.toThrow(/scope global/);
    await expect(
      handleQueryDesign(tmpRoot, { page: "home", component: "PrimaryButton" })
    ).rejects.toThrow(/only one/);
  });
});
