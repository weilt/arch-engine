import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyAffectedTargets,
  detectChangedSources,
  readIngestState,
  runIncrementalDesignSync,
  snapshotSourceFiles,
} from "../../src/design/incremental.js";
import { runDesignSync } from "../../src/design/sync.js";
import { queryDesign } from "../../src/design/query.js";
import { getDesignComponentsDir, getDesignIngestStatePath } from "../../src/design/paths.js";
import { reindexDesignIds } from "../../src/design/vectors.js";

async function writeBaoyuDsFixture(root: string): Promise<void> {
  const dsDir = path.join(root, "designs", "acme-ds");
  await fs.mkdir(path.join(dsDir, "components"), { recursive: true });
  await fs.writeFile(
    path.join(dsDir, "tokens.css"),
    `:root {
  --colorPrimary: #3366ff;
  --spacingMd: 16px;
}
`,
    "utf-8"
  );
  await fs.writeFile(path.join(dsDir, "styles.css"), '@import "./tokens.css";\n', "utf-8");
  await fs.writeFile(
    path.join(dsDir, "_ds_manifest.json"),
    JSON.stringify({ namespace: "AcmeDS_abc123", components: ["Button", "Card"] }),
    "utf-8"
  );
  await fs.writeFile(
    path.join(dsDir, "_ds_prompt.md"),
    "# Acme DS\n\nUse primary blue.\n",
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

describe("design incremental sync", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "design-incremental-"));
    await writeBaoyuDsFixture(tmpRoot);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("detectChangedSources reports added files on first snapshot", async () => {
    const files = await snapshotSourceFiles(tmpRoot, "designs/acme-ds");
    const changes = detectChangedSources(files, null);
    expect(changes.added.length).toBeGreaterThan(0);
    expect(changes.all.length).toBe(changes.added.length);
  });

  it("classifyAffectedTargets maps source paths to design targets", () => {
    const targets = classifyAffectedTargets(
      [
        "designs/acme-ds/tokens.css",
        "designs/acme-ds/components/Button.prompt.md",
        "designs/acme-ds/_ds_prompt.md",
      ],
      "designs/acme-ds"
    );
    expect(targets.tokens).toBe(true);
    expect(targets.style).toBe(true);
    expect(targets.componentIds.has("Button")).toBe(true);
  });

  it("falls back to full sync when ingest state is missing", async () => {
    const report = await runIncrementalDesignSync(tmpRoot, { source: "designs/acme-ds" });
    expect(report.incremental).toBe(false);
    expect(report.componentsWritten).toBe(2);
    await expect(readIngestState(tmpRoot)).resolves.not.toBeNull();
  });

  it("updates only changed component on incremental sync", async () => {
    await runDesignSync(tmpRoot, { source: "designs/acme-ds" });

    const buttonPath = path.join(tmpRoot, "designs", "acme-ds", "components", "Button.prompt.md");
    const cardJson = path.join(getDesignComponentsDir(tmpRoot), "Card.json");
    const buttonBefore = await fs.readFile(
      path.join(getDesignComponentsDir(tmpRoot), "Button.json"),
      "utf-8"
    );
    const cardBeforeMtime = (await fs.stat(cardJson)).mtimeMs;

    await new Promise((r) => setTimeout(r, 20));
    await fs.writeFile(buttonPath, "# Button\n\nUpdated action control with new guidance.\n", "utf-8");

    const reindexSpy = vi.spyOn(
      await import("../../src/design/vectors.js"),
      "reindexDesignIds"
    ).mockResolvedValue({ indexed: 1, skipped: false });

    const report = await runIncrementalDesignSync(tmpRoot, { source: "designs/acme-ds" });
    expect(report.incremental).toBe(true);
    expect(report.componentsWritten).toBe(1);
    expect(report.changedFiles?.some((f) => f.endsWith("Button.prompt.md"))).toBe(true);
    expect(reindexSpy).toHaveBeenCalledWith(tmpRoot, expect.arrayContaining(["Button"]));
    expect(reindexSpy.mock.calls[0]![1]).not.toContain("Card");

    const buttonAfter = await fs.readFile(
      path.join(getDesignComponentsDir(tmpRoot), "Button.json"),
      "utf-8"
    );
    expect(buttonAfter).not.toBe(buttonBefore);
    expect((await fs.stat(cardJson)).mtimeMs).toBe(cardBeforeMtime);

    const button = await queryDesign(tmpRoot, { component: "Button" });
    expect(button.kind).toBe("component");
    if (button.kind === "component") {
      expect(button.component.promptExcerpt).toContain("Updated action");
    }
  });

  it("updates tokens and style without touching unchanged components", async () => {
    await runDesignSync(tmpRoot, { source: "designs/acme-ds" });

    const buttonJson = path.join(getDesignComponentsDir(tmpRoot), "Button.json");
    const buttonMtime = (await fs.stat(buttonJson)).mtimeMs;

    await new Promise((r) => setTimeout(r, 20));
    await fs.writeFile(
      path.join(tmpRoot, "designs", "acme-ds", "tokens.css"),
      `:root { --colorPrimary: #ff0000; }\n`,
      "utf-8"
    );
    await fs.writeFile(
      path.join(tmpRoot, "designs", "acme-ds", "_ds_prompt.md"),
      "# Acme DS\n\nNow use vivid red accents.\n",
      "utf-8"
    );

    const reindexSpy = vi.spyOn(
      await import("../../src/design/vectors.js"),
      "reindexDesignIds"
    ).mockResolvedValue({ indexed: 1, skipped: false });

    const report = await runIncrementalDesignSync(tmpRoot, { source: "designs/acme-ds" });
    expect(report.incremental).toBe(true);
    expect(report.componentsWritten).toBe(0);
    expect(report.tokenFiles.length).toBeGreaterThan(0);
    expect(reindexSpy).toHaveBeenCalledWith(tmpRoot, ["style"]);

    const global = await queryDesign(tmpRoot, { scope: "global" });
    if (global.kind === "global") {
      expect(global.tokens.colors?.colorPrimary).toBe("#ff0000");
      expect(global.style).toContain("vivid red");
    }
    expect((await fs.stat(buttonJson)).mtimeMs).toBe(buttonMtime);
  });

  it("returns no-op report when source files are unchanged", async () => {
    await runDesignSync(tmpRoot, { source: "designs/acme-ds" });
    const report = await runIncrementalDesignSync(tmpRoot, { source: "designs/acme-ds" });
    expect(report.incremental).toBe(true);
    expect(report.componentsWritten).toBe(0);
    expect(report.pagesWritten).toBe(0);
    expect(report.changedFiles).toEqual([]);
  });

  it("persists ingest-state.json after full sync", async () => {
    await runDesignSync(tmpRoot, { source: "designs/acme-ds" });
    const state = await readIngestState(tmpRoot);
    expect(state?.sourceRel).toBe("designs/acme-ds");
    expect(Object.keys(state?.files ?? {}).length).toBeGreaterThan(0);
    await expect(fs.access(getDesignIngestStatePath(tmpRoot))).resolves.toBeUndefined();
  });

  it("reindexDesignIds upserts only requested component chunks", async () => {
    await runDesignSync(tmpRoot, { source: "designs/acme-ds" });

    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    const { VectorStore } = await import("../../src/vector/sqlite-store.js");
    const { getDesignVectorsDbPath } = await import("../../src/design/paths.js");
    const dbPath = getDesignVectorsDbPath(tmpRoot);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    const seed = new VectorStore(dbPath);
    seed.upsertChunks([
      {
        meta: {
          id: "design/components/Button",
          path: "design/components/Button",
          kind: "component",
          title: "Button",
          text: "old",
        },
        embedding: [1, 0, 0],
        sourcePath: "components/Button.json",
      },
      {
        meta: {
          id: "design/components/Card",
          path: "design/components/Card",
          kind: "component",
          title: "Card",
          text: "old card",
        },
        embedding: [0, 1, 0],
        sourcePath: "components/Card.json",
      },
      {
        meta: {
          id: "design/style/0",
          path: "design/style",
          anchor: "0",
          kind: "convention",
          title: "Design style",
          text: "style",
        },
        embedding: [0, 0, 1],
        sourcePath: "style.md",
      },
    ]);
    seed.close();

    vi.spyOn(
      await import("../../src/embedding/openai-compatible.js"),
      "embedTexts"
    ).mockImplementation(async (_config, texts: string[]) => texts.map(() => [1, 0, 0]));

    const result = await reindexDesignIds(tmpRoot, ["Button"]);
    expect(result.indexed).toBe(1);
    expect(result.skipped).toBe(false);

    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
  });
});

describe("classifyAffectedTargets manifest", () => {
  it("marks all components when manifest changes", () => {
    const targets = classifyAffectedTargets(
      ["designs/acme-ds/_ds_manifest.json"],
      "designs/acme-ds"
    );
    expect(targets.allComponents).toBe(true);
  });
});
