import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { ArchConfig, FrontendPackage, RawCandidate } from "../types.js";
import { discoverExports } from "./ts-export.js";
import { extractVueScript } from "./ts-doc.js";

interface PackageJson {
  name?: string;
  description?: string;
  main?: string;
  types?: string;
  exports?: string | Record<string, string | Record<string, unknown>>;
}

function globPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

export function matchesDesignSystemPattern(
  packageName: string,
  patterns: string[]
): boolean {
  if (patterns.length === 0) return false;
  return patterns.some((pattern) => globPatternToRegExp(pattern).test(packageName));
}

export function matchesDesignSystemHeuristic(
  packageName: string,
  slug: string,
  componentCount: number
): boolean {
  if (/^@[^/]+\/ui$/.test(packageName)) return true;
  if (/^@[^/]+\/.+-ui$/.test(packageName)) return true;
  if (slug.endsWith("-ui") && componentCount >= 3) return true;
  return false;
}

export function isDesignSystemPackage(
  pkgJson: PackageJson,
  pkg: Pick<FrontendPackage, "slug" | "components">,
  designSystemPackages: string[] | undefined
): boolean {
  const name = pkgJson.name ?? pkg.slug;
  if (matchesDesignSystemPattern(name, designSystemPackages ?? [])) {
    return true;
  }
  return matchesDesignSystemHeuristic(name, pkg.slug, pkg.components.length);
}

function collectPackageJsonExports(pkgJson: PackageJson): string[] {
  const lines: string[] = [];
  if (pkgJson.main) lines.push(`main: ${pkgJson.main}`);
  if (pkgJson.types) lines.push(`types: ${pkgJson.types}`);

  const exportsField = pkgJson.exports;
  if (typeof exportsField === "string") {
    lines.push(`exports: ${exportsField}`);
  } else if (exportsField && typeof exportsField === "object") {
    for (const [key, value] of Object.entries(exportsField)) {
      if (typeof value === "string") {
        lines.push(`exports.${key}: ${value}`);
      } else {
        lines.push(`exports.${key}: ${JSON.stringify(value)}`);
      }
    }
  }

  return lines;
}

async function readSourceContent(absPath: string): Promise<string> {
  const raw = await fs.readFile(absPath, "utf-8");
  if (absPath.endsWith(".vue")) return extractVueScript(raw);
  return raw;
}

async function collectFirstLevelComponentNames(pkgDir: string): Promise<string[]> {
  const patterns = ["src/*.{ts,tsx,vue}", "src/*/*.{ts,tsx,vue}"];
  const files = await fg.glob(patterns, {
    cwd: pkgDir,
    absolute: false,
    ignore: ["**/node_modules/**", "**/dist/**"],
  });

  const names = new Set<string>();
  for (const relativeFile of files.sort((a, b) => a.localeCompare(b))) {
    try {
      const content = await readSourceContent(path.join(pkgDir, relativeFile));
      const discovered = discoverExports(content, relativeFile);
      if (discovered.length > 0) {
        for (const item of discovered) {
          if (item.kindHint === "component") names.add(item.name);
        }
      } else {
        names.add(path.basename(relativeFile, path.extname(relativeFile)));
      }
    } catch {
      // skip unreadable files
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

export async function discoverFrontendStarterCandidates(
  projectRoot: string,
  pkgDir: string,
  moduleSlug: string,
  pkg: FrontendPackage,
  config: Pick<ArchConfig, "designSystemPackages"> = {}
): Promise<RawCandidate[]> {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  let pkgJson: PackageJson;
  try {
    pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, "utf-8")) as PackageJson;
  } catch {
    return [];
  }

  if (!isDesignSystemPackage(pkgJson, pkg, config.designSystemPackages)) {
    return [];
  }

  const packageExports = collectPackageJsonExports(pkgJson);
  const componentNames = await collectFirstLevelComponentNames(pkgDir);
  const signatures = [...packageExports, ...componentNames];

  return [
    {
      kind: "starter",
      name: pkgJson.name ?? pkg.name,
      moduleSlug,
      filePath: path.relative(projectRoot, pkgJsonPath).replace(/\\/g, "/"),
      javadoc: pkgJson.description ?? pkg.description ?? "",
      signatures,
      extra: {
        componentCount: String(componentNames.length),
      },
    },
  ];
}
