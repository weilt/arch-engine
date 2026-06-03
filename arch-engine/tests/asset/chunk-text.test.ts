import { describe, it, expect } from "vitest";
import { assetCardToChunkText } from "../../src/asset/chunk-text.js";
import type { AssetCard } from "../../src/types.js";

const sampleCard: AssetCard = {
  id: "backend/base-common/util/JsonUtils",
  kind: "util",
  name: "JsonUtils",
  module: "base-common",
  path: "base-common/src/main/java/com/example/JsonUtils.java",
  summary: "JSON 序列化工具",
  whenToUse: "需要统一 JSON 读写时",
  howToUse: "import com.example.JsonUtils;",
  exports: ["toJson", "fromJson"],
  related: [],
  tags: ["json"],
  source: "scan",
  updatedAt: "2026-06-02T00:00:00.000Z",
};

describe("assetCardToChunkText", () => {
  it("formats card per spec template", () => {
    const text = assetCardToChunkText(sampleCard);

    expect(text).toContain("[util] JsonUtils @ base-common");
    expect(text).toContain("Summary: JSON 序列化工具");
    expect(text).toContain("When to use: 需要统一 JSON 读写时");
    expect(text).toContain("How to use: import com.example.JsonUtils;");
    expect(text).toContain("Exports: toJson, fromJson");
    expect(text).toContain("Tags: json");
    expect(text).toContain(
      "Source path: base-common/src/main/java/com/example/JsonUtils.java"
    );
  });
});
