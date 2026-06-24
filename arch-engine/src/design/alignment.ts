import fs from "node:fs/promises";
import path from "node:path";
import { readFrameworkBindings } from "./bindings.js";
import { getArchAlignmentPath, getDesignDir } from "./paths.js";
import {
  isDesignSystemPackage,
  matchesDesignSystemHeuristic,
} from "../scanners/frontend-starter.js";
import type { FrontendPackage } from "../types.js";
import type { FrameworkBindingEntry, FrameworkBindingsFile } from "./types.js";

function isBindingEntry(value: unknown): value is FrameworkBindingEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as FrameworkBindingEntry;
  return Boolean(v.react || v.vue);
}

export type ArchAlignmentConfidence = "high" | "medium" | "low" | "none";

export interface ArchAlignmentSuggestion {
  archComponent: string;
  archPackage: string;
  suggestedSemanticId?: string;
  bindingComponent?: string;
  confidence: ArchAlignmentConfidence;
  notes: string;
}

export interface ArchAlignmentReport {
  generatedAt: string;
  uiPackages: string[];
  bindingFramework?: string;
  bindingLibrary?: string;
  suggestions: ArchAlignmentSuggestion[];
}

export interface BuildDesignArchAlignmentOptions {
  designSystemPackages?: string[];
}

function stripUiPrefix(name: string): string {
  return name.replace(/^(El|A|Mui)/, "");
}

function normalizeName(name: string): string {
  return stripUiPrefix(name).toLowerCase();
}

function normalizeSemanticId(id: string): string {
  return id.replace(/^(Primary|Secondary)/, "");
}

function isUiPackage(
  pkg: FrontendPackage,
  designSystemPackages: string[] | undefined
): boolean {
  if (matchesDesignSystemHeuristic(pkg.name, pkg.slug, pkg.components.length)) {
    return true;
  }
  return isDesignSystemPackage(
    { name: pkg.name },
    pkg,
    designSystemPackages
  );
}

interface BindingMapping {
  semanticId: string;
  bindingComponent: string;
  normalizedBinding: string;
  normalizedSemantic: string;
}

function collectBindingMappings(
  bindings: FrameworkBindingsFile
): BindingMapping[] {
  const framework = bindings._meta.framework;
  const mappings: BindingMapping[] = [];

  for (const [key, entry] of Object.entries(bindings)) {
    if (key === "_meta" || !isBindingEntry(entry)) continue;
    const target = framework === "vue" ? entry.vue : entry.react;
    if (!target?.component) continue;
    mappings.push({
      semanticId: key,
      bindingComponent: target.component,
      normalizedBinding: normalizeName(target.component),
      normalizedSemantic: normalizeName(normalizeSemanticId(key)),
    });
  }

  return mappings;
}

function scoreMatch(
  archComponent: string,
  mapping: BindingMapping
): { confidence: ArchAlignmentConfidence; score: number } | null {
  const archNorm = normalizeName(archComponent);

  if (archNorm === mapping.normalizedBinding) {
    return { confidence: "high", score: 100 };
  }
  if (archNorm === mapping.normalizedSemantic) {
    return { confidence: "medium", score: 80 };
  }
  if (
    mapping.normalizedBinding.includes(archNorm) ||
    archNorm.includes(mapping.normalizedBinding)
  ) {
    return { confidence: "low", score: 40 };
  }
  if (
    mapping.normalizedSemantic.includes(archNorm) ||
    archNorm.includes(mapping.normalizedSemantic)
  ) {
    return { confidence: "low", score: 30 };
  }
  return null;
}

function suggestForArchComponent(
  archComponent: string,
  mappings: BindingMapping[]
): Omit<ArchAlignmentSuggestion, "archComponent" | "archPackage"> {
  const ranked = mappings
    .map((mapping) => {
      const scored = scoreMatch(archComponent, mapping);
      return scored ? { mapping, ...scored } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.score - a.score || a.mapping.semanticId.localeCompare(b.mapping.semanticId));

  if (ranked.length === 0) {
    return {
      confidence: "none",
      notes: "No semantic binding match found; consider adding a design component or binding",
    };
  }

  const best = ranked[0]!;
  const ties = ranked.filter((r) => r.score === best.score);
  const altIds = ties.map((t) => t.mapping.semanticId);
  const notes =
    ties.length > 1
      ? `Multiple semantic ids match (${altIds.join(", ")}); picked ${best.mapping.semanticId}`
      : `Matched via binding component ${best.mapping.bindingComponent}`;

  return {
    suggestedSemanticId: best.mapping.semanticId,
    bindingComponent: best.mapping.bindingComponent,
    confidence: best.confidence,
    notes,
  };
}

export function buildDesignArchAlignmentReport(
  packages: FrontendPackage[],
  bindings: FrameworkBindingsFile | null,
  options: BuildDesignArchAlignmentOptions = {}
): ArchAlignmentReport {
  const uiPackages = packages.filter((pkg) =>
    isUiPackage(pkg, options.designSystemPackages)
  );
  const mappings = bindings ? collectBindingMappings(bindings) : [];
  const suggestions: ArchAlignmentSuggestion[] = [];

  for (const pkg of uiPackages) {
    for (const component of pkg.components) {
      const base = suggestForArchComponent(component.name, mappings);
      suggestions.push({
        archComponent: component.name,
        archPackage: pkg.name,
        ...base,
        notes:
          mappings.length === 0
            ? "framework-bindings.json missing or empty; cannot suggest semantic mapping"
            : base.notes,
      });
    }
  }

  suggestions.sort((a, b) =>
    a.archPackage.localeCompare(b.archPackage) ||
    a.archComponent.localeCompare(b.archComponent)
  );

  return {
    generatedAt: new Date().toISOString(),
    uiPackages: uiPackages.map((p) => p.name),
    bindingFramework: bindings?._meta.framework,
    bindingLibrary: bindings?._meta.library,
    suggestions,
  };
}

export async function buildDesignArchAlignment(
  projectRoot: string,
  packages: FrontendPackage[],
  options: BuildDesignArchAlignmentOptions = {}
): Promise<ArchAlignmentReport> {
  const bindings = await readFrameworkBindings(projectRoot);
  const report = buildDesignArchAlignmentReport(packages, bindings, options);

  await fs.mkdir(getDesignDir(projectRoot), { recursive: true });
  const outPath = getArchAlignmentPath(projectRoot);
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");

  return report;
}

export async function readArchAlignmentReport(
  projectRoot: string
): Promise<ArchAlignmentReport | null> {
  const filePath = getArchAlignmentPath(projectRoot);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as ArchAlignmentReport;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export function getArchAlignmentRelativePath(projectRoot: string): string {
  return path.relative(projectRoot, getArchAlignmentPath(projectRoot)).replace(/\\/g, "/");
}
