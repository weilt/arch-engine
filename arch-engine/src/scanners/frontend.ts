import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import type {
  FrontendEnum,
  ApiClientContract,
  RouteEntry,
  StoreContract,
  FrontendPackage,
  FrontendSymbol,
  RawCandidate,
} from "../types.js";
import { discoverExports } from "./ts-export.js";
import { extractFromSource, extractVueScript } from "./ts-doc.js";
import { archLog } from "../log.js";
import { extractApiClients, isApiClientFile } from "./frontend-api.js";
import { extractRoutes, isRouterFile } from "./frontend-router.js";
import { extractStores, isStoreFile } from "./frontend-store.js";
import { extractVueContract } from "./frontend-vue-contract.js";

interface PackageJson {
  name?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

const SOURCE_GLOBS = ["src/**/*.{ts,tsx,js,jsx,mjs,vue}"];

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

async function readSourceContent(absPath: string): Promise<string> {
  const raw = await fs.readFile(absPath, "utf-8");
  if (absPath.endsWith(".vue")) return extractVueScript(raw);
  return raw;
}

async function collectSourceFiles(pkgDir: string): Promise<string[]> {
  const found = await fg.glob(SOURCE_GLOBS, {
    cwd: pkgDir,
    absolute: false,
    ignore: ["**/node_modules/**", "**/dist/**"],
  });
  return [...new Set(found)].sort((a, b) => a.localeCompare(b));
}

function fileKindHints(
  discovered: ReturnType<typeof discoverExports>
): Set<"component" | "util" | "enum"> {
  return new Set(discovered.map((item) => item.kindHint));
}

function toRawCandidate(
  projectRoot: string,
  pkgDir: string,
  moduleSlug: string,
  relativeFile: string,
  exportItem: { name: string; kindHint: "component" | "util" | "enum" },
  doc: ReturnType<typeof extractFromSource>
): RawCandidate {
  const absPath = path.join(pkgDir, relativeFile);
  const relPath = path.relative(projectRoot, absPath).replace(/\\/g, "/");
  const enumDoc = doc.enums.find((e) => e.name === exportItem.name);

  return {
    kind: exportItem.kindHint,
    name: exportItem.name,
    moduleSlug,
    filePath: relPath,
    javadoc:
      exportItem.kindHint === "enum"
        ? (enumDoc?.description ?? doc.description)
        : doc.description,
    signatures:
      exportItem.kindHint === "enum"
        ? (enumDoc?.members ?? [])
        : doc.exports.filter((line) => line.includes(exportItem.name)),
  };
}

function buildFrontendSymbol(
  relativeFile: string,
  doc: ReturnType<typeof extractFromSource>
): FrontendSymbol {
  const name = path.basename(relativeFile, path.extname(relativeFile));
  return {
    name,
    file: relativeFile,
    description: doc.description,
    exports: doc.exports,
  };
}

function buildFrontendEnum(
  relativeFile: string,
  doc: ReturnType<typeof extractFromSource>,
  exportName: string
): FrontendEnum {
  const enumDoc = doc.enums.find((e) => e.name === exportName);
  return {
    name: exportName,
    file: relativeFile,
    description: enumDoc?.description ?? doc.description,
    members: enumDoc?.members ?? [],
  };
}

export async function discoverFrontendCandidates(
  projectRoot: string,
  pkgDir: string,
  moduleSlug: string
): Promise<RawCandidate[]> {
  const candidates: RawCandidate[] = [];
  const files = await collectSourceFiles(pkgDir);

  for (const relativeFile of files) {
    try {
      const content = await readSourceContent(path.join(pkgDir, relativeFile));
      const baseName = path.basename(relativeFile, path.extname(relativeFile));
      const doc = extractFromSource(content, baseName);
      const discovered = discoverExports(content, relativeFile);

      for (const exportItem of discovered) {
        candidates.push(
          toRawCandidate(projectRoot, pkgDir, moduleSlug, relativeFile, exportItem, doc)
        );
      }

      if (discovered.length === 0 && doc.enums.length > 0) {
        for (const enumDoc of doc.enums) {
          candidates.push({
            kind: "enum",
            name: enumDoc.name,
            moduleSlug,
            filePath: path
              .relative(projectRoot, path.join(pkgDir, relativeFile))
              .replace(/\\/g, "/"),
            javadoc: enumDoc.description,
            signatures: enumDoc.members,
          });
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  candidates.sort((a, b) => a.name.localeCompare(b.name));
  return candidates;
}

async function scanPackageDir(
  projectRoot: string,
  pkgDir: string,
  repoSlug?: string
): Promise<FrontendPackage | null> {
  const pkg = await readJson<PackageJson>(path.join(pkgDir, "package.json"));
  if (!pkg?.name) return null;

  const moduleSlug = slugFromPackageName(pkg.name);
  const files = await collectSourceFiles(pkgDir);

 const components: FrontendSymbol[] = [];
 const utils: FrontendSymbol[] = [];
 const enums: FrontendEnum[] = [];
 const apiClients: ApiClientContract[] = [];
 const routes: RouteEntry[] = [];
 const stores: StoreContract[] = [];
const seenComponentFiles = new Set<string>();
  const seenUtilFiles = new Set<string>();
  const seenEnumKeys = new Set<string>();

  for (const relativeFile of files) {
    try {
      const content = await readSourceContent(path.join(pkgDir, relativeFile));
      const baseName = path.basename(relativeFile, path.extname(relativeFile));
      const doc = extractFromSource(content, baseName);
      const discovered = discoverExports(content, relativeFile);
      const hints = fileKindHints(discovered);

      if (hints.has("component") && !seenComponentFiles.has(relativeFile)) {
        const sym = buildFrontendSymbol(relativeFile, doc);
        // For .vue SFCs, enrich the component with the structured contract
        // (props/emits/templateTags) extracted from the RAW SFC text. The loop
        // variable `content` is the script-stripped text, so we re-read the raw
        // file here; extractVueContract needs the full SFC (template + script).
        if (relativeFile.toLowerCase().endsWith(".vue")) {
          try {
            const rawSfc = await fs.readFile(path.join(pkgDir, relativeFile), "utf-8");
            const vc = extractVueContract(rawSfc);
            if (vc) {
              if (vc.templateTags.length > 0) sym.related = vc.templateTags;
              if (vc.props.length > 0) sym.props = vc.props;
              if (vc.emits.length > 0) sym.emits = vc.emits;
            }
          } catch {
            // raw SFC unreadable: leave the symbol registered but unenriched
          }
        }
        components.push(sym);
        seenComponentFiles.add(relativeFile);
      }

      if (hints.has("util") && !seenUtilFiles.has(relativeFile)) {
        utils.push(buildFrontendSymbol(relativeFile, doc));
        seenUtilFiles.add(relativeFile);
      }

      if (hints.has("enum")) {
        for (const exportItem of discovered.filter((item) => item.kindHint === "enum")) {
          const key = `${relativeFile}:${exportItem.name}`;
          if (seenEnumKeys.has(key)) continue;
          enums.push(buildFrontendEnum(relativeFile, doc, exportItem.name));
         seenEnumKeys.add(key);
       }
     }

      if (isApiClientFile(content)) {
       apiClients.push(...extractApiClients(content, relativeFile));
     }

      if (isRouterFile(content)) {
        routes.push(...extractRoutes(content));
      }
      if (isStoreFile(content)) {
        stores.push(...extractStores(content, relativeFile));
      }
 
      if (discovered.length === 0 && doc.enums.length > 0) {
        for (const enumDoc of doc.enums) {
          const key = `${relativeFile}:${enumDoc.name}`;
          if (seenEnumKeys.has(key)) continue;
          enums.push({
            name: enumDoc.name,
            file: relativeFile,
            description: enumDoc.description,
            members: enumDoc.members,
          });
          seenEnumKeys.add(key);
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  components.sort((a, b) => a.name.localeCompare(b.name));
  utils.sort((a, b) => a.name.localeCompare(b.name));
  enums.sort((a, b) => a.name.localeCompare(b.name));
 apiClients.sort((a, b) => a.name.localeCompare(b.name));
 routes.sort((a, b) => a.path.localeCompare(b.path));
 stores.sort((a, b) => a.name.localeCompare(b.name));

  return {
    slug: moduleSlug,
    name: pkg.name,
    description: pkg.description ?? "",
    framework: inferFramework(pkg),
    components,
   utils,
   enums,
   apiClients,
  routes,
  stores,
  repoSlug,
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

// P2: auto-discover frontend packages living in a non-JS repo root. When the
// workspace probe is empty and there is no root package.json, scan the root's
// direct child directories for any that hold a package.json with frontend deps
// (vue/react), so a project whose frontend lives under e.g. "web/" is not
// silently skipped.
async function discoverChildFrontendPackages(
  projectRoot: string,
  repoSlug?: string
): Promise<FrontendPackage[]> {
  let entries;
  try {
    entries = await fs.readdir(projectRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const packages: FrontendPackage[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const childDir = path.join(projectRoot, entry.name);
    const pkg = await readJson<PackageJson>(path.join(childDir, "package.json"));
    if (!pkg?.name) continue;
    if (!inferFramework(pkg)) continue;
    const scanned = await scanPackageDir(projectRoot, childDir, repoSlug);
    if (scanned) packages.push(scanned);
  }

  packages.sort((a, b) => a.slug.localeCompare(b.slug));
  return packages;
}

export async function scanFrontend(
  projectRoot: string,
  repoSlug?: string
): Promise<FrontendPackage[]> {
  const patterns = await getWorkspacePatterns(projectRoot);

  if (patterns.length === 0) {
    const rootPkg = await readJson<PackageJson>(path.join(projectRoot, "package.json"));
    if (rootPkg?.name) {
      const pkg = await scanPackageDir(projectRoot, projectRoot, repoSlug);
      return pkg ? [pkg] : [];
    }
    // Non-JS repo root: auto-discover direct child frontend packages.
    const discovered = await discoverChildFrontendPackages(projectRoot, repoSlug);
    if (discovered.length > 0) {
      archLog.info("frontend: discovered non-root frontend packages", {
        slugs: discovered.map((p) => p.slug),
      });
      return discovered;
    }
    archLog.warn(
      "frontend: no workspace, no root package.json, and no frontend child packages discovered"
    );
    return [];
  }

  const pkgJsonPaths = await fg.glob(workspacePackageJsonGlobs(patterns), {
    cwd: projectRoot,
    absolute: true,
  });

  const packages: FrontendPackage[] = [];
  for (const pkgJsonPath of pkgJsonPaths) {
    const scanned = await scanPackageDir(projectRoot, path.dirname(pkgJsonPath), repoSlug);
    if (scanned) packages.push(scanned);
  }

  packages.sort((a, b) => a.slug.localeCompare(b.slug));
  return packages;
}
