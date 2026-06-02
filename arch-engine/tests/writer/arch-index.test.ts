import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getArchIndexMdPath, getArchIndexPath } from "../../src/paths.js";
import type { DocumentModel } from "../../src/types.js";
import {
  buildArchIndex,
  loadArchIndex,
  readArchIndex,
  renderIndexMd,
  writeArchIndex,
  writeIndexMd,
} from "../../src/writer/arch-index.js";

const fixtureModel: DocumentModel = {
  modules: [{ slug: "auth", name: "auth", path: "services/auth" }],
  apis: [
    {
      id: "POST-/auth/login",
      method: "POST",
      path: "/auth/login",
      summary: "User login",
      tags: ["auth"],
      audience: "frontend-facing",
      source: "openapi",
      moduleSlug: "auth",
    },
  ],
  rpcs: [],
  packages: [
    {
      slug: "ui",
      name: "@app/ui",
      description: "Shared UI",
      components: [],
      utils: [],
    },
  ],
};

describe("arch-index", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arch-index-"));
    await fs.mkdir(path.join(tmpRoot, ".ai", "arch"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("buildArchIndex returns root and module nodes", () => {
    const index = buildArchIndex(fixtureModel);

    expect(index.root).toBe("root");
    expect(index.nodes.root.children).toEqual(["backend", "frontend"]);
    expect(index.nodes["backend/auth"]).toBeDefined();
    expect(index.nodes["backend/auth/api"]?.docFile).toBe("backend/auth/api.md");
    expect(index.nodes["backend/auth/api"]?.anchors).toContain("POST-/auth/login");
    expect(index.nodes["frontend/ui"]).toBeDefined();
  });

  it("writeArchIndex and writeIndexMd persist JSON and markdown", async () => {
    const index = buildArchIndex(fixtureModel);
    await writeArchIndex(tmpRoot, index);
    await writeIndexMd(tmpRoot, index);

    const json = JSON.parse(
      await fs.readFile(getArchIndexPath(tmpRoot), "utf-8")
    ) as { root: string };
    const md = await fs.readFile(getArchIndexMdPath(tmpRoot), "utf-8");

    expect(json.root).toBe("root");
    expect(md).toContain("## Backend Modules");
    expect(md).toContain("auth");
    expect(md).toContain("@app/ui");
  });

  it("renderIndexMd lists modules and packages in tables", () => {
    const md = renderIndexMd(buildArchIndex(fixtureModel));
    expect(md).toContain("| auth |");
    expect(md).toContain("| @app/ui |");
  });

  it("readArchIndex and loadArchIndex round-trip JSON", async () => {
    const index = buildArchIndex(fixtureModel);
    await writeArchIndex(tmpRoot, index);

    const fromPath = await readArchIndex(getArchIndexPath(tmpRoot));
    const fromRoot = await loadArchIndex(tmpRoot);

    expect(fromPath.root).toBe("root");
    expect(fromPath.nodes["backend/auth"]).toBeDefined();
    expect(fromRoot).toEqual(fromPath);
  });
});
