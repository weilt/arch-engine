import fs from "node:fs/promises";
import path from "node:path";
import { checkFrameworkBindings } from "./bindings.js";
import { MissingDesignProfileError } from "./errors.js";
import { getUiPatternFilePath } from "./implementations.js";
import { snapshotSourceFiles } from "./incremental.js";
import {
  getDesignComponentsDir,
  getDesignPagesDir,
} from "./paths.js";
import { readDesignProfile } from "./query.js";
import type { DesignPageRecipe, DesignProfile } from "./types.js";

const HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/g;
const PX_VALUE_RE = /\b\d+px\b/g;

const TOKEN_SCAN_EXTENSIONS = new Set([
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".vue",
  ".css",
  ".scss",
  ".sass",
  ".less",
]);

export interface AuditDesignStaleItem {
  sourceRel: string;
  sourceMtimeMs: number;
  syncedAt: string;
}

export interface AuditDesignMissingBindingItem {
  componentId: string;
}

export interface AuditDesignPageGapItem {
  page: string;
  unknownComponents: string[];
}

export interface AuditDesignUndeclaredImplementationItem {
  page: string;
  level: "warn";
}

export interface AuditDesignTokenViolationItem {
  path: string;
  line: number;
  kind: "hex" | "px";
  match: string;
}

export interface AuditDesignChangesResult {
  ok: boolean;
  profile: { syncedAt: string; sourceMtimeMs?: number; primarySource: string };
  stale: AuditDesignStaleItem[];
  missing_bindings: AuditDesignMissingBindingItem[];
  page_gaps: AuditDesignPageGapItem[];
  undeclared_implementations: AuditDesignUndeclaredImplementationItem[];
  token_violations: AuditDesignTokenViolationItem[];
}

export interface AuditDesignChangesOptions {
  sourcePaths?: string[];
}

async function listJsonIds(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function maxMtime(files: Record<string, number>): number {
  const values = Object.values(files);
  return values.length ? Math.max(...values) : 0;
}

async function detectStale(
  projectRoot: string,
  profile: DesignProfile
): Promise<AuditDesignStaleItem[]> {
  const sourceRel = profile.primarySource.path;
  const files = await snapshotSourceFiles(projectRoot, sourceRel);
  const currentMtime = maxMtime(files);
  const syncedMs = Date.parse(profile.syncedAt);
  if (!Number.isFinite(syncedMs) || currentMtime <= syncedMs) {
    return [];
  }
  return [
    {
      sourceRel,
      sourceMtimeMs: currentMtime,
      syncedAt: profile.syncedAt,
    },
  ];
}

async function collectPageGaps(projectRoot: string): Promise<AuditDesignPageGapItem[]> {
  const componentIds = new Set(await listJsonIds(getDesignComponentsDir(projectRoot)));
  const pagesDir = getDesignPagesDir(projectRoot);
  const pageIds = await listJsonIds(pagesDir);
  const gaps: AuditDesignPageGapItem[] = [];

  for (const pageId of pageIds) {
    const page = await readJsonFile<DesignPageRecipe>(path.join(pagesDir, `${pageId}.json`));
    if (!page) continue;
    const unknown = new Set<string>();
    for (const region of page.regions ?? []) {
      for (const cid of region.components ?? []) {
        if (!componentIds.has(cid)) unknown.add(cid);
      }
    }
    for (const cid of Object.values(page.states ?? {})) {
      if (cid && !componentIds.has(cid)) unknown.add(cid);
    }
    if (unknown.size > 0) {
      gaps.push({ page: pageId, unknownComponents: [...unknown].sort() });
    }
  }

  return gaps.sort((a, b) => a.page.localeCompare(b.page));
}

async function collectMissingBindings(
  projectRoot: string
): Promise<AuditDesignMissingBindingItem[]> {
  const report = await checkFrameworkBindings(projectRoot);
  const warning = report.warnings.find((w) => w.code === "missing_bindings");
  if (!warning?.ids?.length) return [];
  return warning.ids.map((componentId) => ({ componentId }));
}

async function collectUndeclaredImplementations(
  projectRoot: string
): Promise<AuditDesignUndeclaredImplementationItem[]> {
  const pageIds = await listJsonIds(getDesignPagesDir(projectRoot));
  const undeclared: AuditDesignUndeclaredImplementationItem[] = [];

  for (const pageId of pageIds) {
    try {
      await fs.access(getUiPatternFilePath(projectRoot, pageId));
    } catch {
      undeclared.push({ page: pageId, level: "warn" });
    }
  }

  return undeclared.sort((a, b) => a.page.localeCompare(b.page));
}

async function collectScanTargets(
  projectRoot: string,
  sourcePaths: string[]
): Promise<string[]> {
  const targets = new Set<string>();

  for (const rel of sourcePaths) {
    const normalized = rel.replace(/\\/g, "/");
    const abs = path.resolve(projectRoot, normalized);
    let st;
    try {
      st = await fs.stat(abs);
    } catch {
      continue;
    }
    if (st.isFile()) {
      targets.add(normalized);
      continue;
    }
    if (st.isDirectory()) {
      await walkScanDir(projectRoot, abs, targets);
    }
  }

  return [...targets].sort();
}

async function walkScanDir(
  projectRoot: string,
  dirAbs: string,
  targets: Set<string>
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      await walkScanDir(projectRoot, full, targets);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (TOKEN_SCAN_EXTENSIONS.has(ext)) {
        targets.add(path.relative(projectRoot, full).replace(/\\/g, "/"));
      }
    }
  }
}

function scanLineForViolations(
  filePath: string,
  lineNumber: number,
  line: string
): AuditDesignTokenViolationItem[] {
  const hits: AuditDesignTokenViolationItem[] = [];

  for (const match of line.matchAll(HEX_COLOR_RE)) {
    if (match.index === undefined) continue;
    hits.push({
      path: filePath,
      line: lineNumber,
      kind: "hex",
      match: match[0],
    });
  }

  for (const match of line.matchAll(PX_VALUE_RE)) {
    if (match.index === undefined) continue;
    hits.push({
      path: filePath,
      line: lineNumber,
      kind: "px",
      match: match[0],
    });
  }

  return hits;
}

async function collectTokenViolations(
  projectRoot: string,
  sourcePaths?: string[]
): Promise<AuditDesignTokenViolationItem[]> {
  if (!sourcePaths?.length) return [];

  const violations: AuditDesignTokenViolationItem[] = [];
  const targets = await collectScanTargets(projectRoot, sourcePaths);

  for (const relPath of targets) {
    const abs = path.resolve(projectRoot, relPath);
    let content: string;
    try {
      content = await fs.readFile(abs, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      violations.push(...scanLineForViolations(relPath, i + 1, lines[i] ?? ""));
    }
  }

  return violations;
}

export async function auditDesignChanges(
  projectRoot: string,
  options: AuditDesignChangesOptions = {}
): Promise<AuditDesignChangesResult> {
  const profile = await readDesignProfile(projectRoot);

  const [stale, missing_bindings, page_gaps, undeclared_implementations, token_violations] =
    await Promise.all([
      detectStale(projectRoot, profile),
      collectMissingBindings(projectRoot),
      collectPageGaps(projectRoot),
      collectUndeclaredImplementations(projectRoot),
      collectTokenViolations(projectRoot, options.sourcePaths),
    ]);

  const ok = stale.length === 0 && missing_bindings.length === 0 && page_gaps.length === 0;

  return {
    ok,
    profile: {
      syncedAt: profile.syncedAt,
      sourceMtimeMs: profile.sourceMtimeMs,
      primarySource: profile.primarySource.path,
    },
    stale,
    missing_bindings,
    page_gaps,
    undeclared_implementations,
    token_violations,
  };
}

export { MissingDesignProfileError };
