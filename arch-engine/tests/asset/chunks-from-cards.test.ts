import { describe, it, expect } from "vitest";
import { assetCardsToChunks } from "../../src/asset/chunks-from-cards.js";
import type { AssetCard } from "../../src/types.js";

describe("assetCardsToChunks", () => {
  it("maps cards to stable ArchChunk ids and paths", () => {
    const cards: AssetCard[] = [
      {
        id: "frontend/ui/component/Button",
        kind: "component",
        name: "Button",
        module: "ui",
        path: "packages/ui/src/components/Button.tsx",
        summary: "按钮组件",
        whenToUse: "表单提交",
        howToUse: "import { Button } from '@demo/ui'",
        exports: ["Button"],
        related: [],
        tags: ["ui"],
        source: "scan",
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
    ];

    const chunks = assetCardsToChunks(cards, "frontend");
    expect(chunks[0]).toMatchObject({
      id: "frontend/ui/component/Button",
      path: "frontend/ui/component",
      kind: "component",
      title: "Button",
    });
    expect(chunks[0]?.text).toContain("When to use: 表单提交");
  });
});
