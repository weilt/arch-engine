import { assetCardToChunkText } from "./chunk-text.js";
import { slugifyAnchor } from "../writer/asset-md.js";
import type { ArchChunk, AssetCard, AssetKind } from "../types.js";

const CHUNK_KINDS: Set<AssetKind> = new Set([
  "api",
  "rpc",
  "component",
  "util",
  "enum",
  "starter",
  "pojo",
]);

function toChunkKind(kind: AssetKind): ArchChunk["kind"] {
  if (CHUNK_KINDS.has(kind)) return kind as ArchChunk["kind"];
  return "util";
}

export function assetCardsToChunks(
  cards: AssetCard[],
  scope: "backend" | "frontend"
): ArchChunk[] {
  return cards.map((card) => ({
    id: card.id,
    path: `${scope}/${card.module}/${card.kind}`,
    anchor: slugifyAnchor(card.name),
    kind: toChunkKind(card.kind),
    title: card.name,
    text: assetCardToChunkText(card),
  }));
}
