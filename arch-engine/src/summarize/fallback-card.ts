import { buildAssetId } from "../asset/id.js";
import type { AssetCard, RawCandidate } from "../types.js";

export function buildFallbackCard(
  candidate: RawCandidate,
  scope: "backend" | "frontend"
): AssetCard {
  const tags =
    candidate.extra?.tags
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean) ?? [];

  return {
    id: buildAssetId(scope, candidate.moduleSlug, candidate.kind, candidate.name),
    kind: candidate.kind,
    name: candidate.name,
    module: candidate.moduleSlug,
    path: candidate.filePath,
    summary: "扫描失败，待人工补充",
    whenToUse: "暂无",
    howToUse: "暂无",
    exports: candidate.signatures.slice(0, 20),
    related: [],
    tags,
    source: "scan",
    updatedAt: new Date().toISOString(),
  };
}
