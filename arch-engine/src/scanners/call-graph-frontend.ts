import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type {
  CallGraph,
  CallGraphNode,
  CallGraphEdge,
  FrontendPackage,
} from "../types.js";
import { extractVueContract } from "./frontend-vue-contract.js";

// Relative module specifiers only; bare packages (vue, axios) and path
// aliases (@/components/...) are intentionally skipped here.
// TODO: path alias resolution (tsconfig paths / vite alias -> absolute file).
const RELATIVE_PREFIXES = ["./", "../"];

const SOURCE_GLOBS = ["src/**/*.{ts,tsx,js,jsx,vue}"];

// Resolution order for an import target without an extension, mirroring the
// TS/Vite module resolution a bundler would apply. `as-is` (empty) covers
// specifiers that already include their extension (e.g. "./UserCard.vue").
const EXTENSION_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".vue", "/index.ts", "/index.vue"];

/**
 * Frontend component dependency scanner. Emits a CallGraph whose nodes are
 * components (one per source file basename + every template tag) and whose
 * edges are ES `import` relationships (`imports`) and Vue template usage
 * (`template`). Both edge kinds are `confidence: "high"` — an explicit import
 * or `<Tag />` usage is an unambiguous dependency.
 */
export async function scanCallGraphFrontend(
  projectRoot: string,
  packageDirs: Map<string, string>,
  packages: FrontendPackage[]
): Promise<CallGraph> {
  const edges: CallGraphEdge[] = [];
  const seenEdges = new Set<string>();

  const addEdge = (
    from: string,
    to: string,
    kind: CallGraphEdge["kind"],
    confidence: "high" | "low"
  ): void => {
    const key = `${from}|${to}|${kind}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from, to, kind, confidence });
  };

  // Basename -> attachment metadata, so nodes that resolve to a real source
  // file carry filePath/moduleSlug (template-only tags like <ElButton> do not).
  const metaByBasename = new Map<string, { filePath: string; moduleSlug: string }>();

  for (const pkg of packages) {
    const pkgDir = packageDirs.get(pkg.slug);
    if (!pkgDir) continue;

    let files: string[] = [];
    try {
      files = await fg.glob(SOURCE_GLOBS, {
        cwd: pkgDir,
        absolute: true,
        ignore: ["**/node_modules/**", "**/dist/**"],
      });
    } catch {
      continue;
    }

    for (const absFile of files) {
      try {
        await processFile(absFile, pkg.slug, projectRoot, addEdge, metaByBasename);
      } catch {
        // Per-file degradation: a single unreadable/odd file is skipped.
        continue;
      }
    }
  }

  // Build nodes from every component name surfaced by an edge.
  const nodeNames = new Set<string>();
  for (const edge of edges) {
    nodeNames.add(stripComponent(edge.from));
    nodeNames.add(stripComponent(edge.to));
  }

  const nodes: CallGraphNode[] = [];
  for (const name of nodeNames) {
    const node: CallGraphNode = {
      id: `component:${name}`,
      kind: "method",
      name,
    };
    const meta = metaByBasename.get(name);
    if (meta) {
      node.filePath = meta.filePath;
      node.moduleSlug = meta.moduleSlug;
    }
    nodes.push(node);
  }

  return { nodes, edges };
}

async function processFile(
  absFile: string,
  moduleSlug: string,
  projectRoot: string,
  addEdge: (from: string, to: string, kind: CallGraphEdge["kind"], confidence: "high" | "low") => void,
  metaByBasename: Map<string, { filePath: string; moduleSlug: string }>
): Promise<void> {
  const ext = path.extname(absFile);
  const basename = path.basename(absFile, ext);
  const importerId = `component:${basename}`;

  // Record attachment metadata for this file's component node.
  metaByBasename.set(basename, {
    filePath: path.relative(projectRoot, absFile).replace(/\\/g, "/"),
    moduleSlug,
  });

  const content = await fs.readFile(absFile, "utf-8");
  // Tolerate a leading UTF-8 BOM before regex/scanner passes.
  const source = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  // --- ES imports (named / default / namespace / side-effect) ---
  for (const spec of extractImportSpecifiers(source)) {
    if (!isRelative(spec)) continue;

    const target = await resolveImportTarget(absFile, spec);
    if (!target) continue; // target not found on disk -> skip this edge

    const targetBasename = path.basename(target, path.extname(target));
    addEdge(importerId, `component:${targetBasename}`, "imports", "high");
  }

  // --- Vue template usage (<Tag />) ---
  if (ext === ".vue") {
    const contract = extractVueContract(source);
    if (contract) {
      for (const tag of contract.templateTags) {
        addEdge(importerId, `component:${tag}`, "template", "high");
      }
    }
  }
}

/** Module specifiers from every `import` statement (the quoted string). */
function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  // import ... from "path"  |  import "path"
  // The binding span (`{ a, b }`, `D`, `* as N`) may cross newlines but never
  // contains a quote/backtick/semicolon, so [^'"`;] bounds each match cleanly.
  const importRe = /\bimport\b(?:[^'"`;]*?\bfrom\b)?\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importRe)) {
    const spec = match[1];
    if (spec) specs.push(spec);
  }
  return specs;
}

function isRelative(spec: string): boolean {
  return RELATIVE_PREFIXES.some((prefix) => spec.startsWith(prefix));
}

/**
 * Resolve a relative specifier to an existing file, trying the common
 * extension/index fallbacks. Returns the absolute path or null when nothing
 * resolves (import target absent from disk).
 */
async function resolveImportTarget(
  importerFile: string,
  spec: string
): Promise<string | null> {
  const base = path.resolve(path.dirname(importerFile), spec);
  for (const suffix of EXTENSION_CANDIDATES) {
    const candidate = base + suffix;
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

async function isFile(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target);
    return stat.isFile();
  } catch {
    return false;
  }
}

function stripComponent(id: string): string {
  return id.startsWith("component:") ? id.slice("component:".length) : id;
}
