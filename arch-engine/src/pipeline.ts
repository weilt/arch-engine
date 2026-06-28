import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import { loadOrInitConfig, resolveApiKey } from "./config.js";
import { archLog } from "./log.js";
import { buildAllChunks } from "./chunking/semantic.js";
import { embedTexts } from "./embedding/openai-compatible.js";
import {
  GitDiffError,
  getChangedFilesSince,
  getCurrentBranch,
  getCurrentCommit,
  mapFilesToModules,
  mapFilesToPackages,
} from "./incremental/git-diff.js";
import { collectTrackedSourceHashes } from "./incremental/file-hashes.js";
import { readLastScan, writeLastScan } from "./incremental/last-scan.js";
import { getArchDir, getVectorsDbPath } from "./paths.js";
import {
  discoverFrontendCandidates,
  scanFrontend,
} from "./scanners/frontend.js";
import { discoverFrontendStarterCandidates } from "./scanners/frontend-starter.js";
import {
  discoverJavaCandidates,
  discoverJavaStarterCandidates,
  findMavenModules,
  isStarterModule,
  scanJavaSources,
} from "./scanners/java.js";
import { resolveJavaPathRules } from "./scanners/java-path-rules.js";
import { mergeDocumentModel } from "./scanners/merge.js";
import { scanOpenApiGlobs } from "./scanners/openapi.js";
import type {
  ArchChunk,
  ArchConfig,
  AssetCard,
  FrontendPackage,
  JavaModule,
  LastScanState,
  RawCandidate,
} from "./types.js";
import { VectorStore } from "./vector/sqlite-store.js";
import { assetCardsToChunks } from "./asset/chunks-from-cards.js";
import {
  resolveSummarizeBatchSize,
  summarizeCandidates,
  type SummarizeFn,
} from "./summarize/batch.js";
import {
  attachChunksToIndex,
  buildArchIndex,
  loadArchIndex,
  writeArchIndex,
  writeIndexMd,
  writeMarkdownTree,
  type ArchIndex,
} from "./writer/index.js";
import { writeModuleAssetDocs } from "./writer/asset-md.js";
import { buildDesignArchAlignment } from "./design/alignment.js";
import { getDesignProfilePath } from "./design/paths.js";

export type StartInitReport =
  | { status: "config-created" }
  | {
      status: "ok";
      chunkCount: number;
      apiCount: number;
      moduleCount: number;
    };

// Slugify a package.json "name" the same way frontend.ts slugFromPackageName
// does, so the pipeline and scanner agree on package identity.
function slugFromPkgName(name: string): string {
  const base = name.includes("/") ? name.split("/").pop()! : name;
  return base.toLowerCase().replace(/[^a-z0-9-]/gi, "-");
}

// P1: detect units (frontend packages or backend modules) that exist in the
// current scan but were absent from the previous scan, so they are rescanned
// even when no changed file maps to them yet.
export function detectNewUnits(
  currentSlugs: Iterable<string>,
  previousSlugs: Iterable<string>
): Set<string> {
  const previous = new Set(previousSlugs);
  const added = new Set<string>();
  for (const slug of currentSlugs) {
    if (!previous.has(slug)) added.add(slug);
  }
  return added;
}

export interface PipelineDeps {
  summarizeFn?: SummarizeFn;
  batchSize?: number;
}

export interface PipelineOptions {
  /** Force full rescan (ignore last-scan.json). */
  full?: boolean;
}

export interface ModuleBatchResult {
  cards: AssetCard[];
  chunks: ArchChunk[];
}

export async function cleanArchDir(projectRoot: string): Promise<void> {
  const archDir = getArchDir(projectRoot);
  let entries: string[];
  try {
    entries = await fs.readdir(archDir);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.mkdir(archDir, { recursive: true });
      return;
    }
    throw e;
  }

  for (const entry of entries) {
    if (entry === "arch.config.json" || entry === "arch.secrets.json") continue;
    await fs.rm(path.join(archDir, entry), { recursive: true, force: true });
  }
}

async function readOverviewMarkdowns(
  projectRoot: string,
  modules: JavaModule[],
  packageSlugs: string[]
): Promise<Map<string, string>> {
  const archDir = getArchDir(projectRoot);
  const map = new Map<string, string>();

  for (const mod of modules) {
    const pathKey = `backend/${mod.slug}/overview`;
    const filePath = path.join(archDir, "backend", mod.slug, "overview.md");
    try {
      map.set(pathKey, await fs.readFile(filePath, "utf-8"));
    } catch {
      // overview file may be absent for empty modules
    }
  }

  for (const slug of packageSlugs) {
    const pathKey = `frontend/${slug}/overview`;
    const filePath = path.join(archDir, "frontend", slug, "overview.md");
    try {
      map.set(pathKey, await fs.readFile(filePath, "utf-8"));
    } catch {
      // overview file may be absent for empty packages
    }
  }

  return map;
}

async function resolveFrontendPackageDirs(
  projectRoot: string,
  frontendPackages?: string[]
): Promise<Map<string, string>> {
  const dirs = new Map<string, string>();

  // P2: an explicit config.frontendPackages list takes priority over workspace
  // probing, so non-JS-root projects (frontend in a subdir like "web/") can be
  // declared instead of auto-detected.
  if (frontendPackages && frontendPackages.length > 0) {
    archLog.info("start-init: resolving frontendPackages from config", {
      frontendPackages,
    });
    for (const entry of frontendPackages) {
      const resolved = path.isAbsolute(entry) ? entry : path.resolve(projectRoot, entry);
      try {
        const raw = await fs.readFile(path.join(resolved, "package.json"), "utf-8");
        const pkg = JSON.parse(raw) as { name?: string };
        if (!pkg.name) continue;
        dirs.set(slugFromPkgName(pkg.name), resolved);
      } catch {
        // skip missing or invalid frontend package dir
      }
    }
    return dirs;
  }

  let patterns: string[] = [];
  const pnpmWorkspace = path.join(projectRoot, "pnpm-workspace.yaml");
  try {
    const content = await fs.readFile(pnpmWorkspace, "utf-8");
    const doc = parseYaml(content) as { packages?: string[] };
    patterns = doc.packages ?? [];
  } catch {
    // not a pnpm workspace
  }

  if (patterns.length === 0) {
    try {
      const raw = await fs.readFile(path.join(projectRoot, "package.json"), "utf-8");
      const pkg = JSON.parse(raw) as {
        name?: string;
        workspaces?: string[] | { packages?: string[] };
      };
      if (pkg.workspaces) {
        patterns = Array.isArray(pkg.workspaces)
          ? pkg.workspaces
          : (pkg.workspaces.packages ?? []);
      } else if (pkg.name) {
        const packages = await scanFrontend(projectRoot);
        for (const p of packages) {
          dirs.set(p.slug, projectRoot);
        }
        return dirs;
      }
    } catch {
      return dirs;
    }
  }

  const pkgJsonGlobs = patterns.map((pattern) => {
    const normalized = pattern.replace(/\/+$/, "");
    return normalized.includes("*")
      ? `${normalized}/package.json`
      : `${normalized}/package.json`;
  });

  const pkgJsonPaths = await fg.glob(pkgJsonGlobs, {
    cwd: projectRoot,
    absolute: true,
  });

  for (const pkgJsonPath of pkgJsonPaths) {
    try {
      const raw = await fs.readFile(pkgJsonPath, "utf-8");
      const pkg = JSON.parse(raw) as { name?: string };
      if (!pkg.name) continue;
      dirs.set(slugFromPkgName(pkg.name), path.dirname(pkgJsonPath));
    } catch {
      // skip invalid package.json
    }
  }

  return dirs;
}

function buildLastScanState(
  projectRoot: string,
  previous: LastScanState | null,
  modules: JavaModule[],
  packages: FrontendPackage[],
  packageDirs: Map<string, string>,
  moduleAssetCounts: Map<string, number>,
  packageAssetCounts: Map<string, number>,
  fileHashMap: Record<string, Record<string, string>>,
  commit: string,
  branch: string
): LastScanState {
  const modulesState: LastScanState["modules"] = { ...(previous?.modules ?? {}) };
  for (const mod of modules) {
    modulesState[mod.slug] = {
      sourcePath: mod.path,
      assetCount: moduleAssetCounts.get(mod.slug) ?? modulesState[mod.slug]?.assetCount ?? 0,
      fileHashes: fileHashMap[mod.slug] ?? {},
    };
  }

  const packagesState: LastScanState["packages"] = { ...(previous?.packages ?? {}) };
  for (const pkg of packages) {
    const dir = packageDirs.get(pkg.slug);
    packagesState[pkg.slug] = {
      sourcePath: dir
        ? path.relative(projectRoot, dir).replace(/\\/g, "/")
        : (packagesState[pkg.slug]?.sourcePath ?? pkg.slug),
      assetCount: packageAssetCounts.get(pkg.slug) ?? packagesState[pkg.slug]?.assetCount ?? 0,
      fileHashes: fileHashMap[pkg.slug] ?? {},
    };
  }

  return {
    version: 2,
    commit,
    branch,
    scannedAt: new Date().toISOString(),
    modules: modulesState,
    packages: packagesState,
  };
}

async function mergeIncrementalChunksToIndex(
  projectRoot: string,
  newChunks: ArchChunk[],
  affectedPrefixes: string[]
): Promise<ArchIndex> {
  const index = await loadArchIndex(projectRoot);

  for (const node of Object.values(index.nodes)) {
    if (affectedPrefixes.some((prefix) => node.path === prefix || node.path.startsWith(`${prefix}/`))) {
      node.chunks = [];
    }
  }

  for (const chunk of newChunks) {
    const node = index.nodes[chunk.path];
    if (node) {
      node.chunks.push(chunk.id);
    }
  }

  await writeArchIndex(projectRoot, index);
  return index;
}

export async function runModuleBatch(
  projectRoot: string,
  config: ArchConfig,
  scope: "backend" | "frontend",
  moduleSlug: string,
  candidates: RawCandidate[],
  store: VectorStore,
  deps: PipelineDeps = {}
): Promise<ModuleBatchResult> {
  if (candidates.length === 0) {
    return { cards: [], chunks: [] };
  }

  archLog.info("module-batch: summarize", {
    scope,
    moduleSlug,
    candidateCount: candidates.length,
  });

  const cards = await summarizeCandidates(config, candidates, moduleSlug, {
    batchSize: deps.batchSize ?? resolveSummarizeBatchSize(config),
    summarizeFn: deps.summarizeFn,
    scope,
  });

  await writeModuleAssetDocs(projectRoot, moduleSlug, cards, scope);

  const chunks = assetCardsToChunks(cards, scope);
  if (chunks.length === 0) {
    return { cards, chunks };
  }

  archLog.info("module-batch: embedding", {
    scope,
    moduleSlug,
    chunkCount: chunks.length,
  });

  const embeddings = await embedTexts(
    config,
    chunks.map((c) => c.text)
  );
  const modulePrefix = `${scope}/${moduleSlug}`;
  store.deleteByModule(modulePrefix);
  store.upsertChunks(
    chunks.map((c, i) => ({ meta: c, embedding: embeddings[i]!, sourcePath: cards[i]?.path }))
  );

  return { cards, chunks };
}

export async function runStartInit(
  projectRoot: string,
  deps: PipelineDeps = {},
  options: PipelineOptions = {}
): Promise<StartInitReport> {
  archLog.info("start-init: begin", { projectRoot });

  const { config, created } = await loadOrInitConfig(projectRoot);
  if (created) {
    archLog.info("start-init: created default arch.config.json");
    return { status: "config-created" };
  }

  archLog.info("start-init: config loaded", {
    embeddingModel: config.embedding.model,
    embeddingBaseUrl: config.embedding.baseUrl,
    embeddingApiKeyEnv: config.embedding.apiKeyEnv,
    chunkingModel: config.chunking.chatModel,
    chunkingBaseUrl: config.chunking.baseUrl,
    chunkingApiKeyEnv: config.chunking.apiKeyEnv,
  });

  resolveApiKey(config, "embedding");
  resolveApiKey(config, "chunking");

  const previousScan = await readLastScan(projectRoot);
  let incremental = !options.full && previousScan !== null;
  let affectedModules = new Set<string>();
  let affectedPackages = new Set<string>();

  if (!incremental) {
    archLog.info("start-init: cleaning .ai/arch output");
    await cleanArchDir(projectRoot);
  }

  archLog.info("start-init: scanning project");
  const modules = config.scanners.java ? await findMavenModules(projectRoot) : [];
  let javaPathRules: Awaited<ReturnType<typeof resolveJavaPathRules>> | undefined;
  if (config.scanners.java) {
    javaPathRules = await resolveJavaPathRules(projectRoot);
    archLog.info("start-init: java path rules", {
      confidence: javaPathRules.confidence,
      contextPath: javaPathRules.contextPath || "(none)",
      prefixCount: javaPathRules.controllerPrefixes.length,
      prefixes: javaPathRules.controllerPrefixes.map((r) => ({
        prefix: r.prefix,
        pattern: r.controllerPattern,
      })),
    });
  }
  const { apis: javaApis, rpcs } = config.scanners.java
    ? await scanJavaSources(projectRoot, modules, javaPathRules)
    : { apis: [], rpcs: [] };
  const openApis = await scanOpenApiGlobs(projectRoot, config.apiSpecGlobs);
  const packages = config.scanners.frontend ? await scanFrontend(projectRoot) : [];
  const model = mergeDocumentModel(javaApis, openApis, rpcs, modules, packages);

  archLog.info("start-init: scan complete", {
    modules: model.modules.length,
    apis: model.apis.length,
    rpcs: model.rpcs.length,
    packages: model.packages.length,
    incremental,
  });

  if (!incremental) {
    archLog.info("start-init: writing base markdown and index");
    await writeMarkdownTree(projectRoot, model);
    const index = buildArchIndex(model);
    await writeArchIndex(projectRoot, index);
  }

  const packageDirs = config.scanners.frontend
    ? await resolveFrontendPackageDirs(projectRoot, config.frontendPackages)
    : new Map<string, string>();

  if (incremental && previousScan) {
    try {
      const changed = getChangedFilesSince(projectRoot, previousScan.commit);
      affectedModules = mapFilesToModules(changed, model.modules);
      affectedPackages = mapFilesToPackages(
        changed,
        model.packages,
        packageDirs,
        projectRoot
      );
      // P1: a newly added package/module has no entry in the previous scan, so
      // git diff cannot map any changed file onto it. Pull in any unit present
      // now but absent from previousScan so it still gets scanned.
      const newPackageSlugs = detectNewUnits(
        packageDirs.keys(),
        Object.keys(previousScan.packages)
      );
      for (const slug of newPackageSlugs) affectedPackages.add(slug);
      const newModuleSlugs = detectNewUnits(
        model.modules.map((m) => m.slug),
        Object.keys(previousScan.modules)
      );
      for (const slug of newModuleSlugs) affectedModules.add(slug);
      archLog.info("start-init: incremental mode", {
        changedFiles: changed.length,
        affectedModules: [...affectedModules],
        affectedPackages: [...affectedPackages],
        newPackages: newPackageSlugs.size,
        newModules: newModuleSlugs.size,
      });
    } catch (e) {
      if (e instanceof GitDiffError) {
        archLog.info("start-init: git diff failed, falling back to full scan", {
          error: e instanceof Error ? e.message : String(e),
        });
        incremental = false;
        affectedModules = new Set(model.modules.map((m) => m.slug));
        affectedPackages = new Set(model.packages.map((p) => p.slug));
        await cleanArchDir(projectRoot);
        await writeMarkdownTree(projectRoot, model);
        const index = buildArchIndex(model);
        await writeArchIndex(projectRoot, index);
      } else {
        throw e;
      }
    }
  }

  const modulesToProcess = incremental
    ? model.modules.filter((m) => affectedModules.has(m.slug))
    : model.modules;

  const packagesToProcess = incremental
    ? model.packages.filter((p) => affectedPackages.has(p.slug))
    : model.packages;

  const store = new VectorStore(getVectorsDbPath(projectRoot));
  const allAssetCards: AssetCard[] = [];
  const allChunks: ArchChunk[] = [];
  const moduleAssetCounts = new Map<string, number>(
    Object.entries(previousScan?.modules ?? {}).map(([slug, entry]) => [slug, entry.assetCount])
  );
  const packageAssetCounts = new Map<string, number>(
    Object.entries(previousScan?.packages ?? {}).map(([slug, entry]) => [slug, entry.assetCount])
  );

  try {
    if (!incremental) {
      store.clear();
    }

    for (const mod of modulesToProcess) {
      const javaCandidates = config.scanners.java
        ? await discoverJavaCandidates(projectRoot, mod)
        : [];
      const starterCandidates =
        config.scanners.java && (await isStarterModule(projectRoot, mod))
          ? await discoverJavaStarterCandidates(projectRoot, mod)
          : [];
      const candidates = [...starterCandidates, ...javaCandidates];
      const { cards, chunks } = await runModuleBatch(
        projectRoot,
        config,
        "backend",
        mod.slug,
        candidates,
        store,
        deps
      );
      allAssetCards.push(...cards);
      allChunks.push(...chunks);
      moduleAssetCounts.set(mod.slug, cards.length);
    }

    for (const pkg of packagesToProcess) {
      const pkgDir = packageDirs.get(pkg.slug);
      const frontendCandidates =
        pkgDir && config.scanners.frontend
          ? await discoverFrontendCandidates(projectRoot, pkgDir, pkg.slug)
          : [];
      const starterCandidates =
        pkgDir && config.scanners.frontend
          ? await discoverFrontendStarterCandidates(
              projectRoot,
              pkgDir,
              pkg.slug,
              pkg,
              config
            )
          : [];
      const candidates = [...starterCandidates, ...frontendCandidates];
      const { cards, chunks } = await runModuleBatch(
        projectRoot,
        config,
        "frontend",
        pkg.slug,
        candidates,
        store,
        deps
      );
      allAssetCards.push(...cards);
      allChunks.push(...chunks);
      packageAssetCounts.set(pkg.slug, cards.length);
    }

    if (!incremental) {
      const overviewMarkdowns = await readOverviewMarkdowns(
        projectRoot,
        model.modules,
        model.packages.map((p) => p.slug)
      );
      archLog.info("start-init: semantic chunking for overviews", {
        overviewDocs: overviewMarkdowns.size,
      });
      const overviewChunks = await buildAllChunks(config, model, overviewMarkdowns);
      if (overviewChunks.length > 0) {
        const overviewEmbeddings = await embedTexts(
          config,
          overviewChunks.map((c) => c.text)
        );
        store.upsertChunks(
          overviewChunks.map((c, i) => ({ meta: c, embedding: overviewEmbeddings[i]! }))
        );
      }

      allChunks.push(...overviewChunks);
    }
  } finally {
    store.close();
  }

  if (!incremental) {
    const modelWithAssets = { ...model, assetCards: allAssetCards };
    await writeMarkdownTree(projectRoot, modelWithAssets);
    const updatedIndex = await attachChunksToIndex(projectRoot, allChunks);
    await writeIndexMd(projectRoot, updatedIndex);
  } else if (allChunks.length > 0) {
    const affectedPrefixes = [
      ...[...affectedModules].map((slug) => `backend/${slug}`),
      ...[...affectedPackages].map((slug) => `frontend/${slug}`),
    ];
    const updatedIndex = await mergeIncrementalChunksToIndex(
      projectRoot,
      allChunks,
      affectedPrefixes
    );
    await writeIndexMd(projectRoot, updatedIndex);
  }

  const fileHashMap = await collectTrackedSourceHashes(
    projectRoot,
    model.modules,
    model.packages,
    packageDirs
  );
  const commit = getCurrentCommit(projectRoot);
  const branch = getCurrentBranch(projectRoot);
  await writeLastScan(
    projectRoot,
    buildLastScanState(
      projectRoot,
      previousScan,
      model.modules,
      model.packages,
      packageDirs,
      moduleAssetCounts,
      packageAssetCounts,
      fileHashMap,
      commit,
      branch
    )
  );

  archLog.info("start-init: done", {
    chunkCount: allChunks.length,
    apiCount: model.apis.length,
    moduleCount: model.modules.length,
    assetCardCount: allAssetCards.length,
    incremental,
  });

  try {
    await fs.access(getDesignProfilePath(projectRoot));
    const alignment = await buildDesignArchAlignment(projectRoot, model.packages, {
      designSystemPackages: config.designSystemPackages,
    });
    archLog.info("start-init: design-arch alignment written", {
      uiPackages: alignment.uiPackages.length,
      suggestions: alignment.suggestions.length,
    });
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      archLog.warn("start-init: design-arch alignment skipped", {
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    status: "ok",
    chunkCount: allChunks.length,
    apiCount: model.apis.length,
    moduleCount: model.modules.length,
  };
}
