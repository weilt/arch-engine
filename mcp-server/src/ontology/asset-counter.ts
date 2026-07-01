import fs from "node:fs/promises";
import path from "node:path";
import { getArchDir, loadArchIndex, type ArchIndex } from "@apt/arch-engine";
import type {
  ModuleOntology,
  PackageOntology,
  OntologyAssetCount,
} from "./types.js";

// Markdown asset doc filename -> asset kind (spec section 3.3). overview.md and
// any filename not listed here are ignored (not counted, not an error).
const FILENAME_TO_KIND: Record<string, keyof OntologyAssetCount> = {
  "api.md": "api",
  "rpc.md": "rpc",
  "utils.md": "util",
  "enums.md": "enum",
  "pojo.md": "pojo",
  "starter.md": "starter",
  "components.md": "component",
  "api-clients.md": "apiClient",
  "routes.md": "route",
  "stores.md": "store",
};

// A level-2 markdown header: exactly `##` followed by whitespace. `### ` does
// not match because its third character is `#`, not whitespace.
const H2_HEADER = /^##\s/;

interface AssetCount {
  kind: keyof OntologyAssetCount;
  count: number;
}

async function countH2Headers(filePath: string): Promise<number> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return 0;
  }
  let count = 0;
  for (const line of content.split("\n")) {
    if (H2_HEADER.test(line)) count += 1;
  }
  return count;
}

async function resolveTitles(projectRoot: string): Promise<Record<string, string>> {
  let index: ArchIndex;
  try {
    index = await loadArchIndex(projectRoot);
  } catch {
    // Counting must not depend on index completeness; fall back to slug names.
    return {};
  }
  const titles: Record<string, string> = {};
  for (const [nodePath, node] of Object.entries(index.nodes)) {
    if (nodePath.startsWith("backend/") || nodePath.startsWith("frontend/")) {
      titles[nodePath] = node.title;
    }
  }
  return titles;
}

async function listScope(
  projectRoot: string,
  scopeDir: string,
  pathPrefix: string,
  titles: Record<string, string>
): Promise<{ slug: string; name: string; counts: AssetCount[] }[]> {
  const scopeRoot = path.join(getArchDir(projectRoot), scopeDir);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(scopeRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  slugs.sort();

  const results: { slug: string; name: string; counts: AssetCount[] }[] = [];
  for (const slug of slugs) {
    const slugDir = path.join(scopeRoot, slug);
    let files: string[];
    try {
      files = await fs.readdir(slugDir);
    } catch {
      continue;
    }

    const counts: AssetCount[] = [];
    for (const file of files) {
      const kind = FILENAME_TO_KIND[file];
      if (!kind) continue;
      const count = await countH2Headers(path.join(slugDir, file));
      if (count > 0) counts.push({ kind, count });
    }

    const nodePath = `${pathPrefix}/${slug}`;
    const name = titles[nodePath] ?? slug;
    results.push({ slug, name, counts });
  }
  return results;
}

function buildAssetCounts(counts: AssetCount[]): OntologyAssetCount {
  const assetCounts: OntologyAssetCount = {};
  for (const { kind, count } of counts) {
    assetCounts[kind] = count;
  }
  return assetCounts;
}

export async function listArchModules(
  projectRoot: string
): Promise<ModuleOntology[]> {
  const titles = await resolveTitles(projectRoot);
  const scoped = await listScope(projectRoot, "backend", "backend", titles);
  return scoped.map(({ slug, name, counts }) => ({
    slug,
    name,
    assetCounts: buildAssetCounts(counts),
  }));
}

export async function listArchPackages(
  projectRoot: string
): Promise<PackageOntology[]> {
  const titles = await resolveTitles(projectRoot);
  const scoped = await listScope(projectRoot, "frontend", "frontend", titles);
  // framework intentionally left unset (filled in v2.0.3).
  return scoped.map(({ slug, name, counts }) => ({
    slug,
    name,
    assetCounts: buildAssetCounts(counts),
  }));
}
