import fs from "node:fs/promises";
import path from "node:path";
import { getArchDir, getVectorsDbPath } from "../paths.js";
import {
  loadArchIndex,
  writeArchIndex,
  writeIndexMd,
  type ArchIndex,
} from "../writer/arch-index.js";
import {
  getAssetDocRelativePath,
  removeAssetSectionFromMarkdown,
} from "../writer/asset-md.js";
import { VectorStore } from "../vector/sqlite-store.js";
import type { AssetKind } from "../types.js";

const ASSET_ID_RE =
  /^(backend|frontend)\/([^/]+)\/(api|rpc|component|util|enum|starter|pojo)\/(.+)$/;

export interface RemoveAssetInput {
  assetId?: string;
  sourcePath?: string;
}

export interface RemoveAssetResult {
  ok: true;
  assetId: string;
  sourcePath?: string;
}

function parseAssetId(assetId: string): {
  scope: "backend" | "frontend";
  module: string;
  kind: AssetKind;
  name: string;
} {
  const m = assetId.match(ASSET_ID_RE);
  if (!m) {
    throw new Error(`Invalid assetId: ${assetId}`);
  }
  return {
    scope: m[1] as "backend" | "frontend",
    module: m[2]!,
    kind: m[3] as AssetKind,
    name: m[4]!,
  };
}

function unpatchArchIndexForAsset(index: ArchIndex, assetId: string): void {
  const { scope, module, kind, name } = parseAssetId(assetId);
  const kindPath = `${scope}/${module}/${kind}`;
  const kindNode = index.nodes[kindPath];
  if (!kindNode) return;

  kindNode.anchors = (kindNode.anchors ?? []).filter((a) => a !== name);
  kindNode.chunks = (kindNode.chunks ?? []).filter((c) => c !== assetId);
  const count = kindNode.anchors?.length ?? 0;
  kindNode.summary = `${count} ${kind} asset(s)`;
}

export async function removeAssetFromArch(
  projectRoot: string,
  input: RemoveAssetInput
): Promise<RemoveAssetResult> {
  if (!input.assetId && !input.sourcePath) {
    throw new Error("Either assetId or sourcePath is required");
  }

  const store = new VectorStore(getVectorsDbPath(projectRoot));
  let assetId = input.assetId;
  let sourcePath = input.sourcePath?.replace(/\\/g, "/");

  try {
    if (!assetId && sourcePath) {
      const ids = store.assetIdsBySourcePath(sourcePath);
      if (ids.length === 0) {
        throw new Error(`No indexed asset for source: ${sourcePath}`);
      }
      assetId = ids[0];
    }
    if (!assetId) {
      throw new Error("Could not resolve assetId");
    }

    if (!sourcePath) {
      sourcePath = store.getSourcePathForAssetId(assetId);
    }

    const { scope, module, kind, name } = parseAssetId(assetId);
    const docRel = getAssetDocRelativePath(scope, module, kind);
    if (docRel) {
      const filePath = path.join(getArchDir(projectRoot), docRel);
      try {
        const existing = await fs.readFile(filePath, "utf-8");
        const updated = removeAssetSectionFromMarkdown(existing, name, kind);
        await fs.writeFile(filePath, updated, "utf-8");
      } catch {
        // doc missing — still remove vectors and index
      }
    }

    store.deleteByIds([assetId]);

    const index = await loadArchIndex(projectRoot);
    unpatchArchIndexForAsset(index, assetId);
    await writeArchIndex(projectRoot, index);
    await writeIndexMd(projectRoot, index);
  } finally {
    store.close();
  }

  return { ok: true, assetId, sourcePath };
}
