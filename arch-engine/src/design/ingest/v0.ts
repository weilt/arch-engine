import fs from "node:fs/promises";
import path from "node:path";
import { assertDesignId } from "../ids.js";
import type {
  DesignPageRecipe,
  DesignProfile,
  V0PageManifest,
  V0PageType,
} from "../types.js";
import { V0_PAGE_TYPES } from "../types.js";

export interface V0RefFile {
  name: string;
  absPath: string;
  sourceName: string;
}

export interface V0IngestResult {
  page: DesignPageRecipe;
  warnings: string[];
  sourceMtimeMs: number;
  logicAbsPath: string;
  refFiles: V0RefFile[];
  profile: Omit<DesignProfile, "syncedAt" | "componentCount" | "pageCount">;
}

const MANIFEST_FILE = "page.manifest.json";
const LOGIC_FILE = "page.logic.md";
const TSX_FILE = "page.tsx";
const PREVIEW_FILE = "preview.html";

const REQUIRED_MANIFEST_FIELDS = [
  "id",
  "pageType",
  "feature",
  "title",
  "route",
  "description",
] as const;

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, "/");
}

function isV0PageType(value: string): value is V0PageType {
  return (V0_PAGE_TYPES as readonly string[]).includes(value);
}

export function readV0Manifest(raw: unknown): V0PageManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("page.manifest.json must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    const value = obj[field];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`page.manifest.json missing required field: ${field}`);
    }
  }
  const pageType = obj.pageType as string;
  if (!isV0PageType(pageType)) {
    throw new Error(
      `page.manifest.json pageType must be one of: ${V0_PAGE_TYPES.join(", ")}`
    );
  }
  assertDesignId(obj.id as string, "page");
  return {
    id: obj.id as string,
    pageType,
    feature: obj.feature as string,
    title: obj.title as string,
    route: obj.route as string,
    description: obj.description as string,
    v0Url: typeof obj.v0Url === "string" ? obj.v0Url : undefined,
    status: typeof obj.status === "string" ? obj.status : undefined,
    reviewedBy: typeof obj.reviewedBy === "string" ? obj.reviewedBy : undefined,
    reviewedAt: typeof obj.reviewedAt === "string" ? obj.reviewedAt : undefined,
  };
}

export async function loadV0Manifest(sourceDirAbs: string): Promise<V0PageManifest> {
  const manifestPath = path.join(sourceDirAbs, MANIFEST_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf-8");
  } catch {
    throw new Error(`Missing required file: ${MANIFEST_FILE}`);
  }
  return readV0Manifest(JSON.parse(raw));
}

export async function readV0Logic(sourceDirAbs: string): Promise<string> {
  const logicPath = path.join(sourceDirAbs, LOGIC_FILE);
  try {
    const text = await fs.readFile(logicPath, "utf-8");
    if (!text.trim()) {
      throw new Error("page.logic.md is empty");
    }
    return text;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Missing required file: ${LOGIC_FILE}`);
    }
    throw e;
  }
}

export function inferPageTypeFromTsx(tsxContent: string): V0PageType | null {
  const lower = tsxContent.toLowerCase();
  if (/\b(datatable|table)\b/.test(lower) || /<table\b/.test(lower)) {
    return "list";
  }
  if (/\bform\b/.test(lower) || /<form\b/.test(lower) || /\bonSubmit\b/.test(tsxContent)) {
    return "form";
  }
  if (/\bdashboard\b/.test(lower)) {
    return "dashboard";
  }
  if (/\b(login|signin|signup|register)\b/.test(lower)) {
    return "auth";
  }
  if (/\bsettings\b/.test(lower)) {
    return "settings";
  }
  if (/\b(wizard|stepper)\b/.test(lower)) {
    return "wizard";
  }
  if (/\bdetail\b/.test(lower)) {
    return "detail";
  }
  return null;
}

function extractDataComponentsFromTsx(tsx: string, warnings: string[]): string[] {
  const components: string[] = [];
  const re = /data-component=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tsx)) !== null) {
    const id = m[1]!.trim();
    if (!id) continue;
    if (!components.includes(id)) components.push(id);
  }
  if (components.length === 0) {
    warnings.push("No data-component attributes found in page.tsx; using empty main region");
  }
  return components;
}

function buildApproval(manifest: V0PageManifest): DesignPageRecipe["approval"] {
  if (!manifest.status) return undefined;
  return {
    status: manifest.status,
    reviewedBy: manifest.reviewedBy,
    reviewedAt: manifest.reviewedAt,
  };
}

async function collectRefFiles(
  sourceDirAbs: string,
  pageId: string
): Promise<V0RefFile[]> {
  const refs: V0RefFile[] = [];
  const tsxAbs = path.join(sourceDirAbs, TSX_FILE);
  try {
    await fs.access(tsxAbs);
    refs.push({
      name: `${pageId}.tsx`,
      absPath: tsxAbs,
      sourceName: TSX_FILE,
    });
  } catch {
    // optional
  }
  const previewAbs = path.join(sourceDirAbs, PREVIEW_FILE);
  try {
    await fs.access(previewAbs);
    refs.push({
      name: `${pageId}.html`,
      absPath: previewAbs,
      sourceName: PREVIEW_FILE,
    });
  } catch {
    // optional
  }
  return refs;
}

async function sourceDirMtimeMs(sourceDirAbs: string): Promise<number> {
  const files = [MANIFEST_FILE, LOGIC_FILE, TSX_FILE, PREVIEW_FILE];
  let max = 0;
  for (const name of files) {
    try {
      const st = await fs.stat(path.join(sourceDirAbs, name));
      max = Math.max(max, st.mtimeMs);
    } catch {
      // skip missing
    }
  }
  return max;
}

export async function discoverV0PageSourceDirs(
  projectRoot: string,
  sourceRel: string
): Promise<string[]> {
  const sourceAbs = path.resolve(projectRoot, sourceRel);
  const singleManifest = path.join(sourceAbs, MANIFEST_FILE);
  try {
    await fs.access(singleManifest);
    return [normalizeRel(sourceRel)];
  } catch {
    // batch scan
  }

  let entries;
  try {
    entries = await fs.readdir(sourceAbs, { withFileTypes: true });
  } catch {
    throw new Error(`v0 source directory not found: ${sourceRel}`);
  }

  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const childRel = normalizeRel(path.join(sourceRel, entry.name));
    const childManifest = path.join(sourceAbs, entry.name, MANIFEST_FILE);
    try {
      await fs.access(childManifest);
      dirs.push(childRel);
    } catch {
      // skip dirs without manifest
    }
  }

  if (dirs.length === 0) {
    throw new Error(
      `No v0 page directories with ${MANIFEST_FILE} found under ${sourceRel}`
    );
  }
  return dirs.sort();
}

export async function ingestV0Source(
  projectRoot: string,
  sourceDirRel: string
): Promise<V0IngestResult> {
  const sourceDirRelNorm = normalizeRel(sourceDirRel);
  const sourceDirAbs = path.resolve(projectRoot, sourceDirRelNorm);
  const manifest = await loadV0Manifest(sourceDirAbs);
  const logicMarkdown = await readV0Logic(sourceDirAbs);
  const warnings: string[] = [];

  if (manifest.status && manifest.status !== "approved") {
    warnings.push(
      `Manifest status is "${manifest.status}"; query_design will report manifest-not-approved`
    );
  }

  let tsxContent: string | null = null;
  const tsxAbs = path.join(sourceDirAbs, TSX_FILE);
  try {
    tsxContent = await fs.readFile(tsxAbs, "utf-8");
  } catch {
    warnings.push("No page.tsx implementation reference found");
  }

  if (tsxContent) {
    const inferred = inferPageTypeFromTsx(tsxContent);
    if (inferred && inferred !== manifest.pageType) {
      warnings.push(
        `TSX heuristic suggests pageType "${inferred}" but manifest declares "${manifest.pageType}"; using manifest`
      );
    }
  }

  const components = tsxContent ? extractDataComponentsFromTsx(tsxContent, warnings) : [];
  const refFiles = await collectRefFiles(sourceDirAbs, manifest.id);
  const refPaths = refFiles.map((r) => `refs/${r.name}`);
  const logicPath = `logic/${manifest.id}.md`;
  const manifestPath = `${sourceDirRelNorm}/${MANIFEST_FILE}`;

  const page: DesignPageRecipe = {
    id: manifest.id,
    title: manifest.title,
    pageType: manifest.pageType,
    feature: manifest.feature,
    route: manifest.route,
    description: manifest.description,
    v0Url: manifest.v0Url,
    logicPath,
    manifestPath,
    approval: buildApproval(manifest),
    regions: [{ id: "main", components }],
    refPaths: refPaths.length > 0 ? refPaths : undefined,
  };

  const profile: V0IngestResult["profile"] = {
    version: 1,
    primarySource: { tool: "v0", path: sourceDirRelNorm },
    sources: [{ tool: "v0", path: sourceDirRelNorm, role: "page" }],
    warnings: [],
    sourceMtimeMs: await sourceDirMtimeMs(sourceDirAbs),
  };

  return {
    page,
    warnings,
    sourceMtimeMs: profile.sourceMtimeMs ?? 0,
    logicAbsPath: path.join(sourceDirAbs, LOGIC_FILE),
    refFiles,
    profile,
  };
}
