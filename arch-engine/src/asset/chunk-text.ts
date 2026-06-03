import type { AssetCard } from "../types.js";

export function assetCardToChunkText(card: AssetCard): string {
  const exportsLine =
    card.exports.length > 0 ? card.exports.join(", ") : "暂无";
  const tagsLine = card.tags.length > 0 ? card.tags.join(", ") : "暂无";

  return [
    `[${card.kind}] ${card.name} @ ${card.module}`,
    `Summary: ${card.summary}`,
    `When to use: ${card.whenToUse}`,
    `How to use: ${card.howToUse}`,
    `Exports: ${exportsLine}`,
    `Tags: ${tagsLine}`,
    `Source path: ${card.path}`,
  ].join("\n");
}
