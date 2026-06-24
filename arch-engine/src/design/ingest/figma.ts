import fs from "node:fs/promises";
import path from "node:path";
import { bucketTokens } from "./css-tokens.js";
import { isValidDesignId } from "../ids.js";
import type { DesignComponentCard, DesignProfile } from "../types.js";

export interface FigmaVariable {
  name: string;
  value: string;
  resolvedType?: string;
}

export interface FigmaComponent {
  name: string;
  key?: string;
  description?: string;
}

export interface FigmaExport {
  fileKey?: string;
  name?: string;
  exportedAt?: string;
  variables?: FigmaVariable[];
  components?: FigmaComponent[];
}

export interface FigmaIngestResult {
  profile: Omit<DesignProfile, "syncedAt" | "componentCount" | "pageCount">;
  tokens: Record<string, Record<string, string>>;
  components: DesignComponentCard[];
  warnings: string[];
  sourceMtimeMs: number;
  refFile?: { name: string; absPath: string };
}

const FIGMA_DRAFT_WARNING =
  "Figma ingest produces draft tokens/components; manual review required before production use";

function isJsonSource(source: string): boolean {
  return /\.json$/i.test(source);
}

function looksLikeFileKey(source: string): boolean {
  return /^[a-zA-Z0-9]{10,128}$/.test(source) && !isJsonSource(source);
}

export function figmaVarNameToTokenKey(name: string): string {
  const parts = name.split("/").filter(Boolean);
  if (parts.length === 0) return name.replace(/[^a-zA-Z0-9]/g, "");
  const [first, ...rest] = parts;
  const head = first!.replace(/[-_](.)/g, (_, c: string) => c.toUpperCase());
  const tail = rest
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).replace(/[-_](.)/g, (_, c: string) => c.toUpperCase()))
    .join("");
  return head + tail;
}

export function formatFigmaVariableValue(variable: FigmaVariable, warnings: string[]): string {
  const { value, resolvedType, name } = variable;
  if (resolvedType === "COLOR") {
    return value.startsWith("#") || value.startsWith("rgb") ? value : `#${value.replace(/^#/, "")}`;
  }
  if (resolvedType === "FLOAT") {
    if (/^\d+(\.\d+)?$/.test(value)) {
      return /spacing|radius|size|gap|padding|margin/i.test(name) ? `${value}px` : value;
    }
  }
  if (resolvedType === "STRING") {
    return value;
  }
  if (!resolvedType) {
    warnings.push(`Figma variable "${name}" missing resolvedType; using raw value`);
  }
  return value;
}

export function mapFigmaVariablesToTokens(
  variables: FigmaVariable[],
  warnings: string[]
): Record<string, Record<string, string>> {
  const flat: Record<string, string> = {};
  for (const variable of variables) {
    if (!variable.name?.trim()) {
      warnings.push("Skipping Figma variable with empty name");
      continue;
    }
    const key = figmaVarNameToTokenKey(variable.name);
    flat[key] = formatFigmaVariableValue(variable, warnings);
  }
  return bucketTokens(flat);
}

export function componentIdFromFigmaName(
  name: string,
  warnings: string[]
): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    warnings.push("Skipping Figma component with empty name");
    return null;
  }

  if (isValidDesignId(trimmed)) {
    return trimmed;
  }

  const segment = trimmed.includes("/") ? trimmed.split("/").pop()! : trimmed;
  const pascal = segment
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  if (pascal && isValidDesignId(pascal)) {
    if (pascal !== trimmed) {
      warnings.push(
        `Figma component "${trimmed}" mapped to semantic id "${pascal}"; verify manually`
      );
    }
    return pascal;
  }

  warnings.push(`Figma component "${trimmed}" could not map to a valid semantic id; skipped`);
  return null;
}

export function mapFigmaComponentsToCards(
  components: FigmaComponent[],
  warnings: string[]
): DesignComponentCard[] {
  const cards: DesignComponentCard[] = [];
  const seen = new Set<string>();

  for (const comp of components) {
    const id = componentIdFromFigmaName(comp.name, warnings);
    if (!id || seen.has(id)) {
      if (id && seen.has(id)) {
        warnings.push(`Duplicate Figma component id "${id}" from "${comp.name}"; skipped`);
      }
      continue;
    }
    seen.add(id);

    if (isValidDesignId(comp.name.trim())) {
      warnings.push(
        `Figma component "${comp.name}" mapped to semantic id "${id}"; verify manually`
      );
    }

    cards.push({
      id,
      role: comp.description?.trim() || undefined,
      sourcePath: comp.key ? `figma:${comp.key}` : undefined,
      constraints: ["draft-from-figma"],
    });
  }

  return cards;
}

export function parseFigmaExport(data: FigmaExport, warnings: string[]): {
  tokens: Record<string, Record<string, string>>;
  components: DesignComponentCard[];
} {
  const variables = data.variables ?? [];
  const components = data.components ?? [];

  if (variables.length === 0) {
    warnings.push("No Figma variables found in export");
  }
  if (components.length === 0) {
    warnings.push("No Figma components found in export");
  }

  return {
    tokens: mapFigmaVariablesToTokens(variables, warnings),
    components: mapFigmaComponentsToCards(components, warnings),
  };
}

async function readFigmaJsonFile(sourceAbs: string): Promise<{ data: FigmaExport; mtimeMs: number }> {
  const text = await fs.readFile(sourceAbs, "utf-8");
  const st = await fs.stat(sourceAbs);
  let data: FigmaExport;
  try {
    data = JSON.parse(text) as FigmaExport;
  } catch {
    throw new Error(`Invalid Figma export JSON: ${sourceAbs}`);
  }
  return { data, mtimeMs: st.mtimeMs };
}

export async function fetchFigmaExport(fileKey: string, token: string): Promise<FigmaExport> {
  const headers = { "X-Figma-Token": token };
  const fileRes = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=1`, { headers });
  if (!fileRes.ok) {
    throw new Error(`Figma API files error: ${fileRes.status} ${fileRes.statusText}`);
  }
  const fileData = (await fileRes.json()) as {
    name?: string;
    components?: Record<string, { name?: string; description?: string }>;
  };

  const components: FigmaComponent[] = Object.entries(fileData.components ?? {}).map(
    ([key, meta]) => ({
      name: meta.name ?? key,
      key,
      description: meta.description,
    })
  );

  const variables: FigmaVariable[] = [];
  try {
    const varRes = await fetch(`https://api.figma.com/v1/files/${fileKey}/variables/local`, {
      headers,
    });
    if (varRes.ok) {
      const varData = (await varRes.json()) as {
        meta?: {
          variables?: Record<
            string,
            { name?: string; resolvedType?: string; valuesByMode?: Record<string, unknown> }
          >;
        };
      };
      for (const [id, variable] of Object.entries(varData.meta?.variables ?? {})) {
        const modes = variable.valuesByMode ?? {};
        const firstValue = Object.values(modes)[0];
        variables.push({
          name: variable.name ?? id,
          value: formatApiVariableValue(firstValue),
          resolvedType: variable.resolvedType,
        });
      }
    }
  } catch {
    // variables endpoint optional (Enterprise); components still usable
  }

  return {
    fileKey,
    name: fileData.name,
    exportedAt: new Date().toISOString(),
    variables,
    components,
  };
}

function formatApiVariableValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && value !== null && "r" in value) {
    const c = value as { r?: number; g?: number; b?: number; a?: number };
    const r = Math.round((c.r ?? 0) * 255);
    const g = Math.round((c.g ?? 0) * 255);
    const b = Math.round((c.b ?? 0) * 255);
    const a = c.a ?? 1;
    if (a < 1) return `rgba(${r}, ${g}, ${b}, ${a})`;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  return JSON.stringify(value);
}

export async function loadFigmaExport(
  projectRoot: string,
  source: string
): Promise<{ data: FigmaExport; sourceRel: string; sourceMtimeMs: number; refFile?: { name: string; absPath: string } }> {
  const token = process.env.FIGMA_ACCESS_TOKEN?.trim();

  if (isJsonSource(source)) {
    const sourceAbs = path.resolve(projectRoot, source);
    const { data, mtimeMs } = await readFigmaJsonFile(sourceAbs);
    return {
      data,
      sourceRel: source,
      sourceMtimeMs: mtimeMs,
      refFile: { name: path.basename(sourceAbs), absPath: sourceAbs },
    };
  }

  if (looksLikeFileKey(source)) {
    if (!token) {
      throw new Error(
        "Figma fileKey requires FIGMA_ACCESS_TOKEN or --source path/to/figma-export.json"
      );
    }
    const data = await fetchFigmaExport(source, token);
    return {
      data,
      sourceRel: `figma:${source}`,
      sourceMtimeMs: Date.now(),
    };
  }

  throw new Error(
    "Figma adapter requires --source path/to/figma-export.json or a Figma fileKey with FIGMA_ACCESS_TOKEN"
  );
}

export async function ingestFigmaSource(
  projectRoot: string,
  source: string
): Promise<FigmaIngestResult> {
  const warnings: string[] = [FIGMA_DRAFT_WARNING];
  const loaded = await loadFigmaExport(projectRoot, source);
  const { tokens, components } = parseFigmaExport(loaded.data, warnings);

  const profile: Omit<DesignProfile, "syncedAt" | "componentCount" | "pageCount"> = {
    version: 1,
    primarySource: { tool: "figma", path: loaded.sourceRel },
    sources: [{ tool: "figma", path: loaded.sourceRel, role: "primary" }],
    warnings,
    sourceMtimeMs: loaded.sourceMtimeMs,
  };

  return {
    profile,
    tokens,
    components,
    warnings,
    sourceMtimeMs: loaded.sourceMtimeMs,
    refFile: loaded.refFile,
  };
}
