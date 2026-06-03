import fs from "node:fs/promises";
import type { ArchChunk, ArchIndexNode, AssetCard, AssetKind, DocumentModel } from "../types.js";
import { getArchIndexMdPath, getArchIndexPath } from "../paths.js";

export interface ArchIndex {
  root: string;
  nodes: Record<string, ArchIndexNode>;
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

const BACKEND_ASSET_KINDS: AssetKind[] = ["util", "enum", "pojo", "starter"];

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
  return `${kind}.md`;
}

function groupModuleAssets(cards: AssetCard[] | undefined, slug: string): AssetCard[] {
  return (cards ?? []).filter((c) => c.module === slug);
}

export function buildArchIndex(model: DocumentModel): ArchIndex {
  const nodes: Record<string, ArchIndexNode> = {};
  const rootKey = "root";

  const backendChildren: string[] = [];
  const frontendChildren: string[] = [];

  for (const mod of model.modules) {
    const modPath = `backend/${mod.slug}`;
    backendChildren.push(modPath);

    const moduleApis = model.apis.filter((a) => a.moduleSlug === mod.slug);
    const moduleRpcs = model.rpcs.filter((r) => r.moduleSlug === mod.slug);
    const moduleAssets = groupModuleAssets(model.assetCards, mod.slug);

    const overviewPath = `${modPath}/overview`;
    const apiPath = `${modPath}/api`;
    const rpcPath = `${modPath}/rpc`;

    const childPaths = [overviewPath, apiPath, rpcPath];

    for (const kind of BACKEND_ASSET_KINDS) {
      const kindCards = moduleAssets.filter((c) => c.kind === kind);
      if (kindCards.length === 0) continue;
      const kindPath = `${modPath}/${kind}`;
      childPaths.push(kindPath);
      nodes[kindPath] = baseNode(
        kindPath,
        "api-doc",
        `${mod.name} ${assetKindLabel(kind)}`,
        `${kindCards.length} ${kind} asset(s)`,
        {
          docFile: `backend/${mod.slug}/${assetKindFile(kind)}`,
          anchors: kindCards.map((c) => c.name),
          keywords: [mod.slug, ...kindCards.map((c) => c.name), ...kindCards.flatMap((c) => c.tags)],
        }
      );
    }

    nodes[modPath] = baseNode(modPath, "module", mod.name, `Backend module ${mod.name}`, {
      children: childPaths,
      keywords: [mod.slug, mod.name, mod.path],
    });

    nodes[overviewPath] = baseNode(
      overviewPath,
      "module",
      `${mod.name} Overview`,
      `Overview for ${mod.name}`,
      {
        docFile: `backend/${mod.slug}/overview.md`,
        keywords: [mod.slug, mod.name],
      }
    );

    nodes[apiPath] = baseNode(
      apiPath,
      "api-doc",
      `${mod.name} API`,
      `${moduleApis.length} HTTP endpoint(s)`,
      {
        docFile: `backend/${mod.slug}/api.md`,
        anchors: moduleApis.map((a) => a.id),
        keywords: [
          mod.slug,
          ...moduleApis.map((a) => a.path),
          ...moduleApis.flatMap((a) => a.tags),
        ],
      }
    );

    nodes[rpcPath] = baseNode(
      rpcPath,
      "api-doc",
      `${mod.name} RPC`,
      `${moduleRpcs.length} RPC endpoint(s)`,
      {
        docFile: `backend/${mod.slug}/rpc.md`,
        anchors: moduleRpcs.map((r) => r.id),
        keywords: [mod.slug, ...moduleRpcs.map((r) => r.name)],
      }
    );
  }

  for (const pkg of model.packages) {
    const pkgPath = `frontend/${pkg.slug}`;
    frontendChildren.push(pkgPath);

    const overviewPath = `${pkgPath}/overview`;
    const componentsPath = `${pkgPath}/components`;
    const utilsPath = `${pkgPath}/utils`;
    const enumsPath = `${pkgPath}/enums`;

    nodes[pkgPath] = baseNode(pkgPath, "package", pkg.name, pkg.description || pkg.name, {
      children: [overviewPath, componentsPath, utilsPath, enumsPath],
      keywords: [pkg.slug, pkg.name, pkg.framework ?? ""].filter(Boolean),
    });

    nodes[overviewPath] = baseNode(
      overviewPath,
      "package",
      `${pkg.name} Overview`,
      pkg.description || `Overview for ${pkg.name}`,
      {
        docFile: `frontend/${pkg.slug}/overview.md`,
        keywords: [pkg.slug, pkg.name],
      }
    );

    nodes[componentsPath] = baseNode(
      componentsPath,
      "component-doc",
      `${pkg.name} Components`,
      `${pkg.components.length} component(s)`,
      {
        docFile: `frontend/${pkg.slug}/components.md`,
        anchors: pkg.components.map((c) => c.name),
        keywords: [pkg.slug, ...pkg.components.map((c) => c.name)],
      }
    );

    nodes[utilsPath] = baseNode(
      utilsPath,
      "component-doc",
      `${pkg.name} Utils`,
      `${pkg.utils.length} util(s)`,
      {
        docFile: `frontend/${pkg.slug}/utils.md`,
        anchors: pkg.utils.map((u) => u.name),
        keywords: [
          pkg.slug,
          ...pkg.utils.map((u) => u.name),
          ...pkg.utils.flatMap((u) => u.exports),
        ],
      }
    );

    nodes[enumsPath] = baseNode(
      enumsPath,
      "component-doc",
      `${pkg.name} Enums`,
      `${pkg.enums.length} enum(s)`,
      {
        docFile: `frontend/${pkg.slug}/enums.md`,
        anchors: pkg.enums.map((e) => e.name),
        keywords: [
          pkg.slug,
          ...pkg.enums.map((e) => e.name),
          ...pkg.enums.flatMap((e) => e.members),
        ],
      }
    );
  }

  nodes.backend = baseNode("backend", "module", "Backend", "Java backend modules", {
    children: backendChildren,
    keywords: ["backend", "java"],
  });

  nodes.frontend = baseNode("frontend", "package", "Frontend", "Frontend packages", {
    children: frontendChildren,
    keywords: ["frontend"],
  });

  nodes[rootKey] = baseNode(rootKey, "root", "Architecture", "Project architecture index", {
    children: ["backend", "frontend"],
    keywords: ["architecture"],
  });

  return { root: rootKey, nodes };
}

export async function readArchIndex(indexPath: string): Promise<ArchIndex> {
  const raw = await fs.readFile(indexPath, "utf-8");
  return JSON.parse(raw) as ArchIndex;
}

export async function loadArchIndex(projectRoot: string): Promise<ArchIndex> {
  return readArchIndex(getArchIndexPath(projectRoot));
}

export async function writeArchIndex(projectRoot: string, index: ArchIndex): Promise<void> {
  await fs.writeFile(getArchIndexPath(projectRoot), JSON.stringify(index, null, 2), "utf-8");
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderIndexMd(index: ArchIndex): string {
  const moduleRows: string[] = [];
  const packageRows: string[] = [];

  for (const node of Object.values(index.nodes)) {
    if (!/^backend\/[^/]+$/.test(node.path) || node.kind !== "module") continue;
    const slug = node.path.slice("backend/".length);
    const apiNode = index.nodes[`backend/${slug}/api`];
    const rpcNode = index.nodes[`backend/${slug}/rpc`];
    const utilsNode = index.nodes[`backend/${slug}/util`];
    const enumsNode = index.nodes[`backend/${slug}/enum`];
    const pojoNode = index.nodes[`backend/${slug}/pojo`];
    const apiSummary = apiNode?.summary ?? "";
    const rpcSummary = rpcNode?.summary ?? "";
    const utilsSummary = utilsNode?.summary ?? "";
    const enumsSummary = enumsNode?.summary ?? "";
    const pojoSummary = pojoNode?.summary ?? "";
    moduleRows.push(
      `| ${escapeCell(node.title)} | ${escapeCell(node.path)} | ${escapeCell(apiSummary)} | ${escapeCell(rpcSummary)} | ${escapeCell(utilsSummary)} | ${escapeCell(enumsSummary)} | ${escapeCell(pojoSummary)} |`
    );
  }

  for (const node of Object.values(index.nodes)) {
    if (!/^frontend\/[^/]+$/.test(node.path) || node.kind !== "package") continue;
    const slug = node.path.slice("frontend/".length);
    const compNode = index.nodes[`frontend/${slug}/components`];
    const utilsNode = index.nodes[`frontend/${slug}/utils`];
    const enumsNode = index.nodes[`frontend/${slug}/enums`];
    packageRows.push(
      `| ${escapeCell(node.title)} | ${escapeCell(node.path)} | ${escapeCell(compNode?.summary ?? "")} | ${escapeCell(utilsNode?.summary ?? "")} | ${escapeCell(enumsNode?.summary ?? "")} |`
    );
  }

  const moduleTable =
    moduleRows.length === 0
      ? "| _None._ | | | | | | |"
      : moduleRows.join("\n");
  const packageTable =
    packageRows.length === 0
      ? "| _None._ | | | | |"
      : packageRows.join("\n");

  return `# Architecture Index

> Auto-generated by arch-engine. Do not edit manually.

## Backend Modules

| Module | Path | APIs | RPCs | Utils | Enums | POJO |
|--------|------|------|------|-------|-------|------|
${moduleTable}

## Frontend Packages

| Package | Path | Components | Utils | Enums |
|---------|------|------------|-------|-------|
${packageTable}
`;
}

export async function writeIndexMd(projectRoot: string, index: ArchIndex): Promise<void> {
  await fs.writeFile(getArchIndexMdPath(projectRoot), renderIndexMd(index), "utf-8");
}

export async function attachChunksToIndex(
  projectRoot: string,
  chunks: ArchChunk[]
): Promise<ArchIndex> {
  const index = await loadArchIndex(projectRoot);

  for (const node of Object.values(index.nodes)) {
    node.chunks = [];
  }

  for (const chunk of chunks) {
    const node = index.nodes[chunk.path];
    if (!node) continue;
    node.chunks.push(chunk.id);
  }

  await writeArchIndex(projectRoot, index);
  return index;
}
