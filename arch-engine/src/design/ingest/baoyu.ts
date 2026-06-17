import fs from "node:fs/promises";
import path from "node:path";
import { tokensFromStylesheet } from "./css-tokens.js";
import { isValidDesignId } from "../ids.js";
import type { DesignComponentCard, DesignPageRecipe, DesignProfile } from "../types.js";

export interface BaoyuDsManifest {
  namespace?: string;
  components?: string[];
  startingPoints?: { name: string; kind?: string; path?: string }[];
  cards?: unknown[];
}

export interface BaoyuMeta {
  type?: string;
  title?: string;
  designSystems?: {
    name: string;
    slug: string;
    namespace?: string;
    dsFolder?: string;
    sourcePath?: string;
  }[];
  primaryDesignSystem?: string | null;
  assets?: Record<
    string,
    {
      versions?: { path: string; subtitle?: string; viewport?: { width?: number; height?: number } }[];
    }
  >;
}

export interface BaoyuIngestResult {
  profile: Omit<DesignProfile, "syncedAt" | "componentCount" | "pageCount">;
  style: string;
  tokens: Record<string, Record<string, string>>;
  components: DesignComponentCard[];
  pages: DesignPageRecipe[];
  warnings: string[];
  sourceMtimeMs: number;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function fileMtimeMs(filePath: string): Promise<number> {
  try {
    const st = await fs.stat(filePath);
    return st.mtimeMs;
  } catch {
    return 0;
  }
}

async function maxMtimeMs(paths: string[]): Promise<number> {
  let max = 0;
  for (const p of paths) {
    max = Math.max(max, await fileMtimeMs(p));
  }
  return max;
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function componentFromPrompt(
  dsRoot: string,
  dsSourceRoot: string | null,
  componentId: string,
  warnings: string[]
): Promise<DesignComponentCard> {
  const searchRoots = [dsSourceRoot, dsRoot].filter(Boolean) as string[];
  for (const root of searchRoots) {
    const candidates = [
      path.join(root, "components", componentId, `${componentId}.prompt.md`),
      path.join(root, "components", `${componentId}.prompt.md`),
    ];
    for (const promptPath of candidates) {
      const text = await readOptional(promptPath);
      if (text) {
        return {
          id: componentId,
          role: extractRole(text),
          promptExcerpt: text.slice(0, 4000),
          sourcePath: path.relative(dsRoot, promptPath).replace(/\\/g, "/"),
        };
      }
    }
  }
  warnings.push(`No prompt.md for component ${componentId}`);
  return { id: componentId };
}

function extractRole(prompt: string): string | undefined {
  const m = prompt.match(/^#\s+.+?\n+([^\n#]+)/);
  return m?.[1]?.trim();
}

async function ingestDsFolder(
  projectRoot: string,
  dsFolderAbs: string,
  dsSourceAbs: string | null,
  meta: { tool: string; path: string; role?: string },
  warnings: string[]
): Promise<{
  tokens: Record<string, Record<string, string>>;
  components: DesignComponentCard[];
  style: string;
}> {
  const manifestPath = path.join(dsFolderAbs, "_ds_manifest.json");
  let manifest: BaoyuDsManifest = {};
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as BaoyuDsManifest;
  } catch {
    warnings.push(`Missing or invalid _ds_manifest.json in ${dsFolderAbs}`);
  }

  const stylesPath = path.join(dsFolderAbs, "styles.css");
  let tokens: Record<string, Record<string, string>> = {};
  try {
    tokens = await tokensFromStylesheet(stylesPath);
  } catch {
    warnings.push(`Could not parse tokens from ${stylesPath}`);
  }

  const promptPath = path.join(dsFolderAbs, "_ds_prompt.md");
  let style = (await readOptional(promptPath)) ?? "";
  if (!style && dsSourceAbs) {
    style = (await readOptional(path.join(dsSourceAbs, "_ds_prompt.md"))) ?? "";
  }
  if (!style) {
    const readme = await readOptional(path.join(dsFolderAbs, "README.md"));
    style = readme ? `# Design constraints\n\n${readme.slice(0, 8000)}` : "";
  }

  const componentIds = manifest.components ?? [];
  const components: DesignComponentCard[] = [];
  for (const id of componentIds) {
    if (!isValidDesignId(id)) {
      warnings.push(`Skipping invalid component id in manifest: ${id}`);
      continue;
    }
    components.push(await componentFromPrompt(dsFolderAbs, dsSourceAbs, id, warnings));
  }

  void projectRoot;
  void meta;
  return { tokens, components, style };
}

function mergeTokens(
  acc: Record<string, Record<string, string>>,
  next: Record<string, Record<string, string>>
): Record<string, Record<string, string>> {
  const out = { ...acc };
  for (const [bucket, values] of Object.entries(next)) {
    out[bucket] = { ...(out[bucket] ?? {}), ...values };
  }
  return out;
}

function pagesFromMeta(meta: BaoyuMeta, projectRel: string): DesignPageRecipe[] {
  const pages: DesignPageRecipe[] = [];
  const assets = meta.assets ?? {};
  for (const [title, asset] of Object.entries(assets)) {
    const latest = asset.versions?.[asset.versions.length - 1];
    if (!latest?.path) continue;
    const id = slugify(title) || slugify(path.basename(latest.path, path.extname(latest.path)));
    pages.push({
      id,
      title,
      regions: [{ id: "main", components: [] }],
      refPaths: [`refs/${path.basename(latest.path)}`],
    });
  }
  void projectRel;
  return pages;
}

export async function ingestBaoyuSource(
  projectRoot: string,
  sourceRel: string
): Promise<BaoyuIngestResult> {
  const sourceAbs = path.resolve(projectRoot, sourceRel);
  const warnings: string[] = [];
  const metaPath = path.join(sourceAbs, "_d_meta.json");
  const rootManifestPath = path.join(sourceAbs, "_ds_manifest.json");

  let meta: BaoyuMeta | null = null;
  const metaText = await readOptional(metaPath);
  if (metaText) {
    meta = JSON.parse(metaText) as BaoyuMeta;
  }

  let allTokens: Record<string, Record<string, string>> = {};
  let allComponents: DesignComponentCard[] = [];
  let styleParts: string[] = [];
  const sources: DesignProfile["sources"] = [];
  const mtimePaths: string[] = [sourceAbs];

  if (meta) {
    const systems = meta.designSystems ?? [];
    const primarySlug = meta.primaryDesignSystem ?? systems[0]?.slug;
    for (const sys of systems) {
      const dsFolderRel = sys.dsFolder ?? `_ds/${sys.slug}`;
      const dsFolderAbs = path.join(sourceAbs, dsFolderRel);
      const dsSourceAbs = sys.sourcePath
        ? path.resolve(projectRoot, sys.sourcePath)
        : null;
      mtimePaths.push(dsFolderAbs);
      if (dsSourceAbs) mtimePaths.push(dsSourceAbs);

      const part = await ingestDsFolder(
        projectRoot,
        dsFolderAbs,
        dsSourceAbs,
        {
          tool: "baoyu-design",
          path: sys.sourcePath ?? sourceRel,
          role: sys.slug === primarySlug ? "primary" : "secondary",
        },
        warnings
      );
      allTokens = mergeTokens(allTokens, part.tokens);
      allComponents.push(...part.components);
      if (part.style) styleParts.push(part.style);
      sources.push({
        tool: "baoyu-design",
        path: sys.sourcePath ?? `${sourceRel}/${dsFolderRel}`,
        role: sys.slug === primarySlug ? "primary" : "secondary",
      });
    }
  } else {
    try {
      await fs.access(rootManifestPath);
      const part = await ingestDsFolder(
        projectRoot,
        sourceAbs,
        sourceAbs,
        { tool: "baoyu-design", path: sourceRel, role: "primary" },
        warnings
      );
      allTokens = mergeTokens(allTokens, part.tokens);
      allComponents = part.components;
      styleParts = part.style ? [part.style] : [];
      sources.push({ tool: "baoyu-design", path: sourceRel, role: "primary" });
    } catch {
      throw new Error(
        `Source is not a baoyu project (_d_meta.json) or design system (_ds_manifest.json): ${sourceRel}`
      );
    }
  }

  const componentMap = new Map<string, DesignComponentCard>();
  for (const c of allComponents) {
    componentMap.set(c.id, c);
  }

  const pages = meta ? pagesFromMeta(meta, sourceRel) : [];

  const profile: Omit<DesignProfile, "syncedAt" | "componentCount" | "pageCount"> = {
    version: 1,
    primarySource: { tool: "baoyu-design", path: sourceRel },
    sources,
    warnings,
    sourceMtimeMs: await maxMtimeMs(mtimePaths),
  };

  return {
    profile,
    style: styleParts.join("\n\n---\n\n"),
    tokens: allTokens,
    components: [...componentMap.values()],
    pages,
    warnings,
    sourceMtimeMs: profile.sourceMtimeMs ?? 0,
  };
}

export async function collectRefFiles(
  projectRoot: string,
  sourceAbs: string,
  meta: BaoyuMeta | null
): Promise<{ name: string; absPath: string }[]> {
  const refs: { name: string; absPath: string }[] = [];
  if (!meta?.assets) return refs;
  for (const asset of Object.values(meta.assets)) {
    for (const v of asset.versions ?? []) {
      if (!v.path) continue;
      const abs = path.join(sourceAbs, v.path);
      refs.push({ name: path.basename(v.path), absPath: abs });
    }
  }
  void projectRoot;
  return refs;
}

export async function readBaoyuMeta(sourceAbs: string): Promise<BaoyuMeta | null> {
  const text = await readOptional(path.join(sourceAbs, "_d_meta.json"));
  return text ? (JSON.parse(text) as BaoyuMeta) : null;
}
