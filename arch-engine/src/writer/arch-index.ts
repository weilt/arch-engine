import fs from "node:fs/promises";
import type { ArchChunk, ArchIndexNode, DocumentModel } from "../types.js";
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

    const overviewPath = `${modPath}/overview`;
    const apiPath = `${modPath}/api`;
    const rpcPath = `${modPath}/rpc`;

    nodes[modPath] = baseNode(modPath, "module", mod.name, `Backend module ${mod.name}`, {
      children: [overviewPath, apiPath, rpcPath],
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

    nodes[pkgPath] = baseNode(pkgPath, "package", pkg.name, pkg.description || pkg.name, {
      children: [overviewPath, componentsPath, utilsPath],
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
        keywords: [pkg.slug, ...pkg.utils.map((u) => u.name)],
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
    const apiSummary = apiNode?.summary ?? "";
    const rpcSummary = rpcNode?.summary ?? "";
    moduleRows.push(
      `| ${escapeCell(node.title)} | ${escapeCell(node.path)} | ${escapeCell(apiSummary)} | ${escapeCell(rpcSummary)} |`
    );
  }

  for (const node of Object.values(index.nodes)) {
    if (!/^frontend\/[^/]+$/.test(node.path) || node.kind !== "package") continue;
    const slug = node.path.slice("frontend/".length);
    const compNode = index.nodes[`frontend/${slug}/components`];
    const utilsNode = index.nodes[`frontend/${slug}/utils`];
    packageRows.push(
      `| ${escapeCell(node.title)} | ${escapeCell(node.path)} | ${escapeCell(compNode?.summary ?? "")} | ${escapeCell(utilsNode?.summary ?? "")} |`
    );
  }

  const moduleTable =
    moduleRows.length === 0
      ? "| _None._ | | | |"
      : moduleRows.join("\n");
  const packageTable =
    packageRows.length === 0
      ? "| _None._ | | | |"
      : packageRows.join("\n");

  return `# Architecture Index

> Auto-generated by arch-engine. Do not edit manually.

## Backend Modules

| Module | Path | APIs | RPCs |
|--------|------|------|------|
${moduleTable}

## Frontend Packages

| Package | Path | Components | Utils |
|---------|------|------------|-------|
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
