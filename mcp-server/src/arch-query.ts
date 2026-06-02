import fs from "node:fs/promises";
import path from "node:path";
import {
  VectorStore,
  embedQuery,
  loadArchIndex,
  loadOrInitConfig,
  getArchDir,
  getVectorsDbPath,
  type ArchIndexNode,
} from "@apt/arch-engine";

function headingMatchesAnchor(heading: string, anchor: string): boolean {
  const normalizedHeading = heading.trim().toLowerCase();
  const normalizedAnchor = anchor.trim().toLowerCase();
  if (normalizedHeading === normalizedAnchor) {
    return true;
  }

  // Arch index anchors use ids like "POST-/auth/login"; headings use "POST /auth/login".
  const fromId = normalizedAnchor.replace(/^([a-z]+)-(\/.+)$/, "$1 $2");
  return normalizedHeading === fromId;
}

export function extractSection(md: string, anchor: string): string {
  const lines = md.split("\n");
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(/^##\s+(.+)$/);
    if (!match) continue;
    if (headingMatchesAnchor(match[1]!, anchor)) {
      start = i;
      break;
    }
  }

  if (start === -1) {
    throw new Error(`Section not found: ${anchor}`);
  }

  const sectionLines = [lines[start]!];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) break;
    sectionLines.push(lines[i]!);
  }

  return sectionLines.join("\n").trim();
}

function mapNodeWithChildren(
  index: Awaited<ReturnType<typeof loadArchIndex>>,
  node: ArchIndexNode
) {
  return {
    ...node,
    children: node.children.map((c) => index.nodes[c]),
  };
}

export async function handleQueryArch(projectRoot: string, archPath?: string) {
  const index = await loadArchIndex(projectRoot);

  if (!archPath) {
    const root = index.nodes[index.root];
    if (!root) throw new Error("Arch index root node missing. Run start-init.");
    return mapNodeWithChildren(index, root);
  }

  const hashIdx = archPath.indexOf("#");
  const pathKey = hashIdx === -1 ? archPath : archPath.slice(0, hashIdx);
  const anchor = hashIdx === -1 ? undefined : archPath.slice(hashIdx + 1);

  const node = index.nodes[pathKey];
  if (!node) {
    throw new Error(`Path not found: ${pathKey}. Try search_arch.`);
  }

  if (anchor && node.docFile) {
    const md = await fs.readFile(
      path.join(getArchDir(projectRoot), node.docFile),
      "utf-8"
    );
    return extractSection(md, anchor);
  }

  return mapNodeWithChildren(index, node);
}

export async function handleSearchArch(
  projectRoot: string,
  query: string,
  limit = 5,
  filter?: { kind?: string }
) {
  const { config } = await loadOrInitConfig(projectRoot);
  const embedding = await embedQuery(config, query);
  const store = new VectorStore(getVectorsDbPath(projectRoot));
  try {
    return store.search(embedding, limit, filter?.kind);
  } finally {
    store.close();
  }
}
