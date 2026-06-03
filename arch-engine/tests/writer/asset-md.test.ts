import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getArchDir } from "../../src/paths.js";
import type { AssetCard } from "../../src/types.js";
import { renderAssetCard, writeModuleAssetDocs } from "../../src/writer/asset-md.js";

const cards: AssetCard[] = [
  {
    id: "backend/base-common/util/JsonUtils",
    kind: "util",
    name: "JsonUtils",
    module: "base-common",
    path: "base-common/src/main/java/com/example/JsonUtils.java",
    summary: "JSON 工具",
    whenToUse: "序列化场景",
    howToUse: "JsonUtils.toJson(obj)",
    exports: ["toJson", "fromJson"],
    related: [],
    tags: [],
    source: "scan",
    updatedAt: "2026-06-02T00:00:00.000Z",
  },
  {
    id: "backend/base-common/enum/CommonStatusEnum",
    kind: "enum",
    name: "CommonStatusEnum",
    module: "base-common",
    path: "base-common/src/main/java/com/example/CommonStatusEnum.java",
    summary: "通用状态枚举",
    whenToUse: "状态码映射",
    howToUse: "CommonStatusEnum.ENABLED",
    exports: ["ENABLED", "DISABLED"],
    related: [],
    tags: [],
    source: "scan",
    updatedAt: "2026-06-02T00:00:00.000Z",
  },
];

describe("asset-md", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arch-asset-md-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("renderAssetCard outputs heading and field table", () => {
    const md = renderAssetCard(cards[0]);
    expect(md).toContain("## JsonUtils");
    expect(md).toContain("| Summary | JSON 工具 |");
    expect(md).toContain("| When to use | 序列化场景 |");
    expect(md).toContain("| Exports | toJson, fromJson |");
  });

  it("writeModuleAssetDocs writes utils.md and enums.md", async () => {
    await writeModuleAssetDocs(tmpRoot, "base-common", cards);

    const archDir = getArchDir(tmpRoot);
    const utilsMd = await fs.readFile(
      path.join(archDir, "backend", "base-common", "utils.md"),
      "utf-8"
    );
    const enumsMd = await fs.readFile(
      path.join(archDir, "backend", "base-common", "enums.md"),
      "utf-8"
    );

    expect(utilsMd).toContain("## JsonUtils");
    expect(utilsMd).toContain("| Summary | JSON 工具 |");
    expect(enumsMd).toContain("## CommonStatusEnum");
  });
});
