import fs from "node:fs/promises";
import path from "node:path";
import { classifyJavaFile } from "../scanners/java-assets.js";
import { parseFeignInterface } from "../scanners/java-feign.js";
import { isApiClientFile } from "../scanners/frontend-api.js";
import { isRouterFile } from "../scanners/frontend-router.js";
import { isStoreFile } from "../scanners/frontend-store.js";
import type { AssetKind, RawCandidate } from "../types.js";

function firstPathSegment(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  const idx = normalized.indexOf("/");
  return idx === -1 ? normalized : normalized.slice(0, idx);
}

/**
 * A PascalCase named export (`export function Foo`, `export const Bar`, ...) or
 * a named `export default function Foo`. Matches how `start-init` (ts-export.ts)
 * flags a component. Non-global so `.test` is safe without lastIndex.
 */
const COMPONENT_EXPORT_RE =
  /export\s+(?:default\s+)?(?:function\s+|const\s+|class\s+)([A-Z]\w*)/;

/**
 * True when the frontend file declares a component: an anonymous
 * `export default function`, or a PascalCase named/default export. Mirrors the
 * component-vs-util heuristic in ts-export.ts so refresh_asset classifies the
 * same way the initial scan does.
 */
function looksLikeComponentExport(content: string): boolean {
  if (/export\s+default\s+function\b/.test(content)) return true;
  return COMPONENT_EXPORT_RE.test(content);
}

/**
 * Content-based classification for TS/JS/Vue files, matching how `start-init`
 * (frontend.ts + the frontend scanners) buckets a file. Order matters: a store
 * definition wins over an api client, which wins over a route table, which wins
 * over a component export; everything else is a util. A `.vue` SFC is always a
 * single-file component regardless of content.
 */
function classifyFrontendFile(relPath: string, content: string): AssetKind {
  if (relPath.replace(/\\/g, "/").toLowerCase().endsWith(".vue")) {
    return "component";
  }
  if (isStoreFile(content)) return "store";
  if (isApiClientFile(content)) return "api-client";
  if (isRouterFile(content)) return "route";
  if (looksLikeComponentExport(content)) return "component";
  return "util";
}

export async function mapFileToCandidate(
  projectRoot: string,
  sourcePath: string,
  moduleSlug?: string
): Promise<RawCandidate | null> {
  const rel = sourcePath.replace(/\\/g, "/");
  const abs = path.resolve(projectRoot, rel);
  let content: string;
  try {
    content = await fs.readFile(abs, "utf-8");
  } catch {
    return null;
  }

  const slug = moduleSlug ?? firstPathSegment(rel);

  if (rel.endsWith(".java")) {
    const classified = classifyJavaFile(content, abs);
    if (!classified) return null;
    const extra: Record<string, string> = {};
    if (classified.kind === "rpc") {
      const feign = parseFeignInterface(content);
      if (feign?.clientRef) extra.clientRef = feign.clientRef;
    }
    if (classified.tags?.length) {
      extra.tags = classified.tags.join(",");
    }
    return {
      kind: classified.kind,
      name: classified.name,
      moduleSlug: slug,
      filePath: rel,
      javadoc: "",
      signatures: [],
      extra,
    };
  }

  if (/\.(tsx?|jsx?|vue)$/.test(rel)) {
    const base = path.basename(rel, path.extname(rel));
    return {
      kind: classifyFrontendFile(rel, content),
      name: base,
      moduleSlug: slug,
      filePath: rel,
      javadoc: "",
      signatures: [],
      extra: {},
    };
  }

  return null;
}
