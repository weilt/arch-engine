import fs from "node:fs/promises";
import path from "node:path";
import { buildAssetId } from "./asset/id.js";
import { assetCardsToChunks } from "./asset/chunks-from-cards.js";
import { loadOrInitConfig } from "./config.js";
import { embedTexts } from "./embedding/openai-compatible.js";
import { getVectorsDbPath, getArchConfigPath } from "./paths.js";
import {
  loadArchIndex,
  writeArchIndex,
  writeIndexMd,
  type ArchIndex,
} from "./writer/arch-index.js";
import { upsertAssetCardInModuleDoc } from "./writer/asset-md.js";
import type { ArchIndexNode, AssetCard, AssetKind } from "./types.js";
import { VectorStore } from "./vector/sqlite-store.js";

const REGISTER_KINDS: AssetKind[] = [
  "component",
  "util",
  "enum",
  "starter",
  "api",
  "rpc",
  "pojo",
];

export interface RegisterAssetInput {
  kind: AssetKind;
  name: string;
  module: string;
  sourcePath: string;
  summary: string;
  whenToUse: string;
  howToUse: string;
  exports?: string[];
  related?: string[];
  tags?: string[];
  /** Override scope inference (backend vs frontend). */
  scope?: "backend" | "frontend";
}

export interface RegisterAssetResult {
  ok: true;
  id: string;
  /** Arch path for query_arch (e.g. backend/base-common/util). */
  path: string;
}

function assetKindLabel(kind: AssetKind): string {
  if (kind === "enum") return "Enums";
  if (kind === "util") return "Utils";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function assetKindFile(kind: AssetKind): string {
  if (kind === "util") return "utils.md";
  if (kind === "enum") return "enums.md";
  if (kind === "pojo") return "pojo.md";
  if (kind === "starter") return "starter.md";
  if (kind === "api") return "api.md";
  if (kind === "rpc") return "rpc.md";
  if (kind === "component") return "components.md";
  return `${kind}.md`;
}

export function inferAssetScope(
  index: ArchIndex,
  module: string,
  sourcePath: string,
  kind: AssetKind
): "backend" | "frontend" {
  if (index.nodes[`frontend/${module}`]) return "frontend";
  if (index.nodes[`backend/${module}`]) return "backend";
  if (kind === "component") return "frontend";
  if (kind === "api" || kind === "rpc" || kind === "pojo" || kind === "starter") {
    return "backend";
  }
  const normalized = sourcePath.replace(/\\/g, "/");
  if (normalized.includes("/packages/") || normalized.startsWith("packages/")) {
    return "frontend";
  }
  return "backend";
}

function baseNode(
  pathKey: string,
  kind: ArchIndexNode["kind"],
  title: string,
  summary: string,
  extra?: Partial<ArchIndexNode>
): ArchIndexNode {
  return {
    path: pathKey,
    kind,
    title,
    summary,
    children: [],
    chunks: [],
    keywords: [],
    ...extra,
  };
}

export function patchArchIndexForAsset(
  index: ArchIndex,
  card: AssetCard,
  scope: "backend" | "frontend"
): void {
  const modulePath = `${scope}/${card.module}`;
  const kindPath = `${modulePath}/${card.kind}`;
  const docFile = `${scope}/${card.module}/${assetKindFile(card.kind)}`;

  const scopePath = scope;
  if (!index.nodes[scopePath]) {
    index.nodes[scopePath] =
      scope === "backend"
        ? baseNode("backend", "module", "Backend", "Java backend modules", {
            children: [],
            keywords: ["backend", "java"],
          })
        : baseNode("frontend", "package", "Frontend", "Frontend packages", {
            children: [],
            keywords: ["frontend"],
          });
    if (!index.nodes.root) {
      index.nodes.root = baseNode("root", "root", "Architecture", "Project architecture index", {
        children: ["backend", "frontend"],
        keywords: ["architecture"],
      });
    }
    if (!index.nodes.root.children.includes(scopePath)) {
      index.nodes.root.children.push(scopePath);
    }
  }

  const scopeNode = index.nodes[scopePath]!;
  if (!scopeNode.children.includes(modulePath)) {
    scopeNode.children.push(modulePath);
  }

  let moduleNode = index.nodes[modulePath];
  if (!moduleNode) {
    moduleNode = baseNode(
      modulePath,
      scope === "backend" ? "module" : "package",
      card.module,
      `${scope} module ${card.module}`,
      { children: [], keywords: [card.module] }
    );
    index.nodes[modulePath] = moduleNode;
  }

  if (!moduleNode.children.includes(kindPath)) {
    moduleNode.children.push(kindPath);
  }

  let kindNode = index.nodes[kindPath];
  const anchors = new Set(kindNode?.anchors ?? []);
  anchors.add(card.name);

  if (!kindNode) {
    kindNode = baseNode(
      kindPath,
      scope === "backend" ? "api-doc" : "component-doc",
      `${card.module} ${assetKindLabel(card.kind)}`,
      `1 ${card.kind} asset(s)`,
      {
        docFile,
        anchors: [...anchors],
        keywords: [card.module, card.name, ...card.tags],
      }
    );
    index.nodes[kindPath] = kindNode;
  } else {
    kindNode.docFile = docFile;
    kindNode.anchors = [...anchors];
    kindNode.summary = `${anchors.size} ${card.kind} asset(s)`;
    kindNode.keywords = [
      ...new Set([...(kindNode.keywords ?? []), card.module, card.name, ...card.tags]),
    ];
  }

  if (!kindNode.chunks.includes(card.id)) {
    kindNode.chunks.push(card.id);
  }
}

export async function registerAssetInArch(
  projectRoot: string,
  input: RegisterAssetInput
): Promise<RegisterAssetResult> {
  if (!REGISTER_KINDS.includes(input.kind)) {
    throw new Error(
      `Invalid kind: ${input.kind}. Use one of: ${REGISTER_KINDS.join(", ")}`
    );
  }

  const absSource = path.resolve(projectRoot, input.sourcePath);
  try {
    await fs.access(absSource);
  } catch {
    throw new Error(`Source file not found: ${input.sourcePath}`);
  }

  const configPath = getArchConfigPath(projectRoot);
  try {
    await fs.access(configPath);
  } catch {
    throw new Error(
      "arch.config.json not found. Run start-init first to initialize architecture."
    );
  }

  const { config } = await loadOrInitConfig(projectRoot);

  let index: ArchIndex;
  try {
    index = await loadArchIndex(projectRoot);
  } catch {
    index = {
      root: "root",
      nodes: {
        root: baseNode("root", "root", "Architecture", "Project architecture index", {
          children: ["backend", "frontend"],
          keywords: ["architecture"],
        }),
        backend: baseNode("backend", "module", "Backend", "Java backend modules", {
          children: [],
          keywords: ["backend"],
        }),
        frontend: baseNode("frontend", "package", "Frontend", "Frontend packages", {
          children: [],
          keywords: ["frontend"],
        }),
      },
    };
  }

  const scope =
    input.scope ?? inferAssetScope(index, input.module, input.sourcePath, input.kind);

  const card: AssetCard = {
    id: buildAssetId(scope, input.module, input.kind, input.name),
    kind: input.kind,
    name: input.name,
    module: input.module,
    path: input.sourcePath.replace(/\\/g, "/"),
    summary: input.summary,
    whenToUse: input.whenToUse,
    howToUse: input.howToUse,
    exports: input.exports ?? [],
    related: input.related ?? [],
    tags: input.tags ?? [],
    source: "register",
    updatedAt: new Date().toISOString(),
  };

  await upsertAssetCardInModuleDoc(projectRoot, card, scope);
  const archPath = `${scope}/${card.module}/${card.kind}`;

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
        sourcePath: card.path,
      }))
    );
  } finally {
    store.close();
  }

  return { ok: true, id: card.id, path: archPath };
}
