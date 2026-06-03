import { describe, expect, it } from "vitest";
import type { AssetCard } from "../../src/types.js";
import { upsertAssetSectionInMarkdown } from "../../src/writer/asset-md.js";

const card: AssetCard = {
  id: "backend/demo/util/JsonUtils",
  kind: "util",
  name: "JsonUtils",
  module: "demo",
  path: "demo/src/JsonUtils.java",
  summary: "JSON helpers",
  whenToUse: "When parsing JSON",
  howToUse: "Use parse()",
  exports: ["parse"],
  related: [],
  tags: ["json"],
  source: "register",
  updatedAt: "2026-06-02T00:00:00.000Z",
};

describe("upsertAssetSectionInMarkdown", () => {
  it("appends section when name is new", () => {
    const md = "# Utils\n\n## Other\n\nOther util.\n";
    const out = upsertAssetSectionInMarkdown(md, card);
    expect(out).toContain("## Other");
    expect(out).toContain("## JsonUtils");
    expect(out).toContain("JSON helpers");
  });

  it("replaces existing section with same name", () => {
    const md = `# Utils

## JsonUtils

| Field | Value |
|-------|-------|
| Summary | old |

## Other

Other.
`;
    const updated: AssetCard = { ...card, summary: "updated summary" };
    const out = upsertAssetSectionInMarkdown(md, updated);
    expect(out).toContain("updated summary");
    expect(out).not.toContain("| Summary | old |");
    expect(out).toContain("## Other");
  });
});
