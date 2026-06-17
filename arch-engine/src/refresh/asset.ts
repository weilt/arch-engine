import fs from "node:fs/promises";
import path from "node:path";
import { buildAssetId } from "../asset/id.js";
import { assetCardsToChunks } from "../asset/chunks-from-cards.js";
import { loadOrInitConfig } from "../config.js";
import { mapFileToCandidate } from "../discovery/map-file.js";
import { embedTexts } from "../embedding/openai-compatible.js";
import { getArchConfigPath, getVectorsDbPath } from "../paths.js";
import {
  inferAssetScope,
  patchArchIndexForAsset,
} from "../register-asset.js";
import { summarizeCandidates, type SummarizeFn } from "../summarize/batch.js";
import { loadArchIndex, writeArchIndex, writeIndexMd } from "../writer/arch-index.js";
import { upsertAssetCardInModuleDoc } from "../writer/asset-md.js";
import type { AssetKind } from "../types.js";
import { VectorStore } from "../vector/sqlite-store.js";

export interface RefreshAssetInput {
  sourcePath: string;
  kind?: AssetKind;
  name?: string;
  module?: string;
}

export interface RefreshAssetResult {
  ok: true;
  id: string;
  path: string;
  action: "created" | "updated";
}

export interface RefreshAssetDeps {
  summarizeFn?: SummarizeFn;
}

export async function refreshAssetInArch(
  projectRoot: string,
  input: RefreshAssetInput,
  deps: RefreshAssetDeps = {}
): Promise<RefreshAssetResult> {
  const rel = input.sourcePath.replace(/\\/g, "/");
  const abs = path.resolve(projectRoot, rel);
  await fs.access(abs);
  await fs.access(getArchConfigPath(projectRoot));

  const { config } = await loadOrInitConfig(projectRoot);
  const index = await loadArchIndex(projectRoot);

  const moduleSlug = input.module ?? rel.split("/")[0] ?? "unknown";
  const candidate = await mapFileToCandidate(projectRoot, rel, moduleSlug);
  if (!candidate) {
    throw new Error(`Cannot infer asset from source: ${rel}`);
  }

  if (input.kind) candidate.kind = input.kind;
  if (input.name) candidate.name = input.name;
  if (input.module) candidate.moduleSlug = input.module;

  const scope = inferAssetScope(index, candidate.moduleSlug, rel, candidate.kind);
  const cards = await summarizeCandidates(
    config,
    [candidate],
    candidate.moduleSlug,
    { batchSize: 1, summarizeFn: deps.summarizeFn, scope }
  );
  const card = cards[0]!;
  card.id = buildAssetId(scope, card.module, card.kind, card.name);
  card.path = rel;
  card.source = "refresh";
  card.updatedAt = new Date().toISOString();

  const kindPath = `${scope}/${card.module}/${card.kind}`;
  const existed = Boolean(index.nodes[kindPath]?.anchors?.includes(card.name));

  await upsertAssetCardInModuleDoc(projectRoot, card, scope);
  patchArchIndexForAsset(index, card, scope);
  await writeArchIndex(projectRoot, index);
  await writeIndexMd(projectRoot, index);

  const chunks = assetCardsToChunks([card], scope);
  const embeddings = await embedTexts(
    config,
    chunks.map((c) => c.text)
  );
  const store = new VectorStore(getVectorsDbPath(projectRoot));
  try {
    store.upsertChunks(
      chunks.map((c, i) => ({
        meta: c,
        embedding: embeddings[i]!,
        sourcePath: rel,
      }))
    );
  } finally {
    store.close();
  }

  return {
    ok: true,
    id: card.id,
    path: `${scope}/${card.module}/${card.kind}`,
    action: existed ? "updated" : "created",
  };
}
