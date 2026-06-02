import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import type { FrontendPackage } from "../types.js";

interface PackageJson {
  name?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function getWorkspacePatterns(projectRoot: string): Promise<string[]> {
  const pnpmWorkspace = path.join(projectRoot, "pnpm-workspace.yaml");
  try {
    const content = await fs.readFile(pnpmWorkspace, "utf-8");
    const doc = parseYaml(content) as { packages?: string[] };
    if (doc.packages?.length) return doc.packages;
  } catch {
    // not a pnpm workspace
  }

  const rootPkg = await readJson<PackageJson>(path.join(projectRoot, "package.json"));
  if (!rootPkg?.workspaces) return [];

  if (Array.isArray(rootPkg.workspaces)) {
    return rootPkg.workspaces;
  }
  return rootPkg.workspaces.packages ?? [];
}

function slugFromPackageName(name: string): string {
  const base = name.includes("/") ? name.split("/").pop()! : name;
  return base.toLowerCase().replace(/[^a-z0-9-]/gi, "-");
}

function inferFramework(pkg: PackageJson): string | undefined {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.vue || deps["@vue/runtime-core"]) return "vue";
  if (deps.react || deps["react-dom"]) return "react";
  return undefined;
}

const COMPONENT_GLOBS = [
  "src/components/*.tsx",
  "src/components/*.ts",
  "src/components/*.vue",
];
const UTIL_GLOBS = ["src/utils/*.tsx", "src/utils/*.ts", "src/utils/*.vue"];

async function scanPackageDir(pkgDir: string): Promise<FrontendPackage | null> {
  const pkg = await readJson<PackageJson>(path.join(pkgDir, "package.json"));
  if (!pkg?.name) return null;

  const components: { name: string; file: string }[] = [];
  const utils: { name: string; file: string }[] = [];

  for (const pattern of COMPONENT_GLOBS) {
    const files = await fg.glob(pattern, { cwd: pkgDir, absolute: false });
    for (const file of files) {
      components.push({
        name: path.basename(file, path.extname(file)),
        file,
      });
    }
  }

  for (const pattern of UTIL_GLOBS) {
    const files = await fg.glob(pattern, { cwd: pkgDir, absolute: false });
    for (const file of files) {
      utils.push({
        name: path.basename(file, path.extname(file)),
        file,
      });
    }
  }

  components.sort((a, b) => a.name.localeCompare(b.name));
  utils.sort((a, b) => a.name.localeCompare(b.name));

  return {
    slug: slugFromPackageName(pkg.name),
    name: pkg.name,
    description: pkg.description ?? "",
    framework: inferFramework(pkg),
    components,
    utils,
  };
}

function workspacePackageJsonGlobs(patterns: string[]): string[] {
  return patterns.map((pattern) => {
    const normalized = pattern.replace(/\/+$/, "");
    return normalized.includes("*")
      ? `${normalized}/package.json`
      : `${normalized}/package.json`;
  });
}

export async function scanFrontend(projectRoot: string): Promise<FrontendPackage[]> {
  const patterns = await getWorkspacePatterns(projectRoot);

  if (patterns.length === 0) {
    const rootPkg = await readJson<PackageJson>(path.join(projectRoot, "package.json"));
    if (!rootPkg?.name) return [];
    const pkg = await scanPackageDir(projectRoot);
    return pkg ? [pkg] : [];
  }

  const pkgJsonPaths = await fg.glob(workspacePackageJsonGlobs(patterns), {
    cwd: projectRoot,
    absolute: true,
  });

  const packages: FrontendPackage[] = [];
  for (const pkgJsonPath of pkgJsonPaths) {
    const scanned = await scanPackageDir(path.dirname(pkgJsonPath));
    if (scanned) packages.push(scanned);
  }

  packages.sort((a, b) => a.slug.localeCompare(b.slug));
  return packages;
}
