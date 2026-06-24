import fs from "node:fs/promises";
import path from "node:path";
import { isValidDesignId } from "../ids.js";
import type { DesignPageRecipe, DesignProfile } from "../types.js";

export interface HtmlIngestResult {
  page: DesignPageRecipe;
  warnings: string[];
  sourceMtimeMs: number;
  refFile: { name: string; absPath: string };
  profile: Omit<DesignProfile, "syncedAt" | "componentCount" | "pageCount">;
}

const SECTION_TAGS = ["header", "main", "footer"] as const;

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return "page";
  return /^[a-z]/.test(slug) ? slug : `page-${slug}`;
}

function pageIdFromPath(sourceRel: string): string {
  const base = path.basename(sourceRel, path.extname(sourceRel));
  const id = slugify(base);
  return isValidDesignId(id) ? id : slugify(base.replace(/[^a-zA-Z0-9_-]/g, "-"));
}

function matchTagBlocks(html: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    blocks.push(m[0]!);
  }
  return blocks;
}

function extractDataComponents(block: string, warnings: string[]): string[] {
  const components: string[] = [];
  const re = /data-component=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const id = m[1]!.trim();
    if (!id) continue;
    if (!isValidDesignId(id)) {
      warnings.push(`Invalid data-component id: ${id}`);
      continue;
    }
    if (!components.includes(id)) {
      components.push(id);
    }
  }
  return components;
}

function extractRegionsFromDataRegion(html: string, warnings: string[]): { id: string; components: string[] }[] {
  const regionMap = new Map<string, string[]>();
  const re =
    /<([a-z][a-z0-9]*)\b[^>]*\bdata-region=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const regionId = slugify(m[2]!.trim());
    const block = m[0]!;
    const components = extractDataComponents(block, warnings);
    const existing = regionMap.get(regionId) ?? [];
    for (const c of components) {
      if (!existing.includes(c)) existing.push(c);
    }
    regionMap.set(regionId, existing);
  }
  return [...regionMap.entries()].map(([id, components]) => ({ id, components }));
}

export function extractTitle(html: string, fallbackId: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch?.[1]?.trim()) return titleMatch[1].trim();
  const h1Match = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  if (h1Match?.[1]?.trim()) return h1Match[1].trim();
  return fallbackId;
}

export function parseHtmlToPageRecipe(
  html: string,
  sourceRel: string,
  warnings: string[] = []
): DesignPageRecipe {
  const id = pageIdFromPath(sourceRel);
  const title = extractTitle(html, id);
  const refName = path.basename(sourceRel);

  let regions: { id: string; components: string[] }[] = extractRegionsFromDataRegion(html, warnings);

  if (regions.length === 0) {
    let foundSection = false;
    for (const tag of SECTION_TAGS) {
      const blocks = matchTagBlocks(html, tag);
      if (blocks.length === 0) continue;
      foundSection = true;
      const components: string[] = [];
      for (const block of blocks) {
        for (const c of extractDataComponents(block, warnings)) {
          if (!components.includes(c)) components.push(c);
        }
      }
      regions.push({ id: tag, components });
    }

    if (!foundSection) {
      const components = extractDataComponents(html, warnings);
      regions.push({ id: "main", components });
    }
  }

  if (regions.length === 0) {
    regions.push({ id: "main", components: [] });
    warnings.push("No regions or data-component attributes found; created empty main region");
  }

  return {
    id,
    title,
    regions,
    refPaths: [`refs/${refName}`],
  };
}

export async function ingestHtmlSource(
  projectRoot: string,
  sourceRel: string
): Promise<HtmlIngestResult> {
  const sourceAbs = path.resolve(projectRoot, sourceRel);
  const warnings: string[] = [];

  let html: string;
  let sourceMtimeMs: number;
  try {
    html = await fs.readFile(sourceAbs, "utf-8");
    const st = await fs.stat(sourceAbs);
    sourceMtimeMs = st.mtimeMs;
  } catch {
    throw new Error(`HTML source not found: ${sourceRel}`);
  }

  if (!/\.html?$/i.test(sourceRel)) {
    throw new Error(`HTML adapter source must be an .html file: ${sourceRel}`);
  }

  const page = parseHtmlToPageRecipe(html, sourceRel, warnings);
  const refName = path.basename(sourceAbs);

  const profile: Omit<DesignProfile, "syncedAt" | "componentCount" | "pageCount"> = {
    version: 1,
    primarySource: { tool: "html", path: sourceRel },
    sources: [{ tool: "html", path: sourceRel, role: "primary" }],
    warnings,
    sourceMtimeMs,
  };

  return {
    page,
    warnings,
    sourceMtimeMs,
    refFile: { name: refName, absPath: sourceAbs },
    profile,
  };
}
