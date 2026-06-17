import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDesignSync } from "../../src/design/sync.js";
import { queryDesign, searchUi } from "../../src/design/query.js";
import { MissingDesignProfileError, InvalidDesignIdError } from "../../src/design/errors.js";

async function writeBaoyuDsFixture(root: string): Promise<void> {
  const dsDir = path.join(root, "designs", "acme-ds");
  await fs.mkdir(path.join(dsDir, "components"), { recursive: true });
  await fs.writeFile(
    path.join(dsDir, "tokens.css"),
    `:root {
  --colorPrimary: #3366ff;
  --spacingMd: 16px;
  --fontFamilyBase: 'Acme Sans', sans-serif;
}
`,
    "utf-8"
  );
  await fs.writeFile(
    path.join(dsDir, "styles.css"),
    '@import "./tokens.css";\n',
    "utf-8"
  );
  await fs.writeFile(
    path.join(dsDir, "_ds_manifest.json"),
    JSON.stringify({
      namespace: "AcmeDS_abc123",
      components: ["Button", "Card"],
    }),
    "utf-8"
  );
  await fs.writeFile(
    path.join(dsDir, "_ds_prompt.md"),
    "# Acme DS\n\nUse primary blue. Never use pure black text.\n",
    "utf-8"
  );
  await fs.writeFile(
    path.join(dsDir, "components", "Button.prompt.md"),
    "# Button\n\nMain action control.\n",
    "utf-8"
  );
  await fs.writeFile(
    path.join(dsDir, "components", "Card.prompt.md"),
    "# Card\n\nGrouped content surface.\n",
    "utf-8"
  );
}

describe("design-sync baoyu ingest", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "design-sync-"));
    await writeBaoyuDsFixture(tmpRoot);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("writes .ai/design from authored design system", async () => {
    const report = await runDesignSync(tmpRoot, { source: "designs/acme-ds" });
    expect(report.componentsWritten).toBe(2);
    expect(report.tokenFiles.length).toBeGreaterThan(0);

    const global = await queryDesign(tmpRoot, { scope: "global" });
    expect(global.kind).toBe("global");
    if (global.kind === "global") {
      expect(global.style).toContain("Acme DS");
      expect(global.tokens.colors?.colorPrimary).toBe("#3366ff");
    }

    const button = await queryDesign(tmpRoot, { component: "Button" });
    expect(button.kind).toBe("component");

    const hits = await searchUi(tmpRoot, { query: "action button" });
    expect(hits.some((h) => h.id === "Button")).toBe(true);
  });

  it("dry-run does not write profile", async () => {
    await runDesignSync(tmpRoot, { source: "designs/acme-ds", dryRun: true });
    await expect(queryDesign(tmpRoot, { scope: "global" })).rejects.toThrow(
      MissingDesignProfileError
    );
  });

  it("rejects path traversal in component query", async () => {
    await runDesignSync(tmpRoot, { source: "designs/acme-ds" });
    await expect(queryDesign(tmpRoot, { component: "../profile" })).rejects.toThrow(
      InvalidDesignIdError
    );
  });
});
