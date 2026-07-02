import crypto from "node:crypto";
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
import {
  resolveJavaPathRules,
  type ResolvedJavaPathRules,
} from "./scanners/java-path-rules.js";
import { mergeDocumentModel } from "./scanners/merge.js";
import { scanOpenApiGlobs } from "./scanners/openapi.js";
import { mergeEntityGraphs } from "./scanners/entity-merge.js";
import { createScannerRegistry, type ScannerContext } from "./scanners/registry.js";
import { loadWorkspace, resolveRepoRoot } from "./workspace.js";
import { scanGoSources } from "./scanners/go-scanner.js";
import { scanPythonSources } from "./scanners/python-scanner.js";
import type {
  ApiEndpoint,
  ArchChunk,
  ArchConfig,
  AssetCard,
  CallGraphEdge,
  CallGraphNode,
  DocumentModel,
  EntityDef,
  EntityRelation,
  FlowEdge,
  FlowNode,
  FrontendPackage,
  JavaModule,
  LastScanState,
  RawCandidate,
  RpcEndpoint,
  WorkspaceConfig,
  WorkspaceRepo,
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
  writePathRulesSnapshot,
  type ArchIndex,
} from "./writer/index.js";
import { writeModuleAssetDocs } from "./writer/asset-md.js";
import { writeEntityDocs } from "./writer/entity-md.js";
import { writeFlowDocs } from "./writer/flow-md.js";
import { writeCallGraph } from "./writer/call-graph.js";
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

/** Stable SHA-256 of resolved path rules (contextPath + prefixes sorted by pattern). */
export function computePathRulesHash(resolved: ResolvedJavaPathRules): string {
  const payload = {
    contextPath: resolved.contextPath,
    controllerPrefixes: [...resolved.controllerPrefixes]
      .sort((a, b) => a.controllerPattern.localeCompare(b.controllerPattern))
      .map((r) => ({
        prefix: r.prefix,
        controllerPattern: r.controllerPattern,
      })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
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
  branch: string,
  pathRulesHash?: string
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
    ...(pathRulesHash !== undefined ? { pathRulesHash } : {}),
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

// v2.1.0: workspace-mode accumulators. Each repo is scanned independently and
// its results are appended here; the merged DocumentModel is built once all
// repos are processed.
interface WorkspaceAccumulator {
  modules: JavaModule[];
  apis: ApiEndpoint[];
  rpcs: RpcEndpoint[];
  packages: FrontendPackage[];
  entityDefs: EntityDef[];
  entityRelations: EntityRelation[];
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  callNodes: CallGraphNode[];
  callEdges: CallGraphEdge[];
  packageDirs: Map<string, string>;
}

/**
 * v2.1.0: Workspace-mode entry point. When apt-workspace.json is present,
 * runStartInit delegates here instead of running the single-repo pipeline.
 * Each repo is scanned independently by language, a failure in one repo never
 * aborts the others, and all results are merged into one DocumentModel written
 * under the workspace .ai/arch tree. Single-repo mode is untouched.
 *
 * v2.1.0 performs the scan + merge + arch-tree/entity/flow/call-graph writes.
 * The asset summarization / embedding (vector store) phase is deferred to a
 * later task, so chunkCount stays 0 for now.
 */
export async function runWorkspaceInit(
  projectRoot: string,
  workspace: WorkspaceConfig,
  config: ArchConfig,
  _deps: PipelineDeps,
  _options: PipelineOptions
): Promise<StartInitReport> {
  archLog.info("start-init: workspace mode", {
    repoCount: workspace.repos.length,
    repos: workspace.repos.map((r) => ({ path: r.path, lang: r.lang, slug: r.slug })),
  });

  const acc: WorkspaceAccumulator = {
    modules: [],
    apis: [],
    rpcs: [],
    packages: [],
    entityDefs: [],
    entityRelations: [],
    flowNodes: [],
    flowEdges: [],
    callNodes: [],
    callEdges: [],
    packageDirs: new Map(),
  };

  for (const repo of workspace.repos) {
    const repoRoot = resolveRepoRoot(projectRoot, repo.path);
    try {
      await fs.access(repoRoot);
    } catch {
      archLog.warn("start-init: workspace repo directory missing, skipping", {
        repo: repo.path,
        slug: repo.slug,
      });
      continue;
    }

    try {
      if (repo.lang === "java") {
        await scanWorkspaceJavaRepo(repo, repoRoot, config, acc);
      } else if (repo.lang === "go") {
        await scanWorkspaceGoRepo(repo, repoRoot, acc);
      } else if (repo.lang === "python") {
        await scanWorkspacePythonRepo(repo, repoRoot, acc);
      } else if (repo.lang === "ts") {
        await scanWorkspaceTsRepo(repo, repoRoot, config, acc);
      }
    } catch (e) {
      archLog.warn("start-init: workspace repo scan failed (non-fatal)", {
        repo: repo.path,
        slug: repo.slug,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const model: DocumentModel = {
    modules: acc.modules,
    apis: acc.apis,
    rpcs: acc.rpcs,
    packages: acc.packages,
    workspace,
    ...(acc.entityDefs.length > 0
      ? { entities: { entities: acc.entityDefs, relations: acc.entityRelations } }
      : {}),
    ...(acc.flowNodes.length > 0
      ? { flows: { nodes: acc.flowNodes, edges: acc.flowEdges } }
      : {}),
    ...(acc.callNodes.length > 0
      ? { callGraph: { nodes: acc.callNodes, edges: acc.callEdges } }
      : {}),
  };

  await cleanArchDir(projectRoot);
  await writeMarkdownTree(projectRoot, model);
  const index = buildArchIndex(model);
  await writeArchIndex(projectRoot, index);

  if (model.entities) {
    try {
      await writeEntityDocs(projectRoot, model.entities);
    } catch (e) {
      archLog.warn("start-init: workspace entity doc write failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (model.flows) {
    try {
      await writeFlowDocs(projectRoot, model.flows);
    } catch (e) {
      archLog.warn("start-init: workspace flow doc write failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (model.callGraph) {
    try {
      await writeCallGraph(projectRoot, model.callGraph);
    } catch (e) {
      archLog.warn("start-init: workspace call-graph doc write failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  archLog.info("start-init: workspace scan complete", {
    repos: workspace.repos.length,
    modules: model.modules.length,
    apis: model.apis.length,
    packages: model.packages.length,
    entities: model.entities?.entities.length ?? 0,
    callGraphNodes: model.callGraph?.nodes.length ?? 0,
  });

  return {
    status: "ok",
    chunkCount: 0,
    apiCount: model.apis.length,
    moduleCount: model.modules.length,
  };
}

/**
 * Java repo: Maven modules + Java source scan, then the entity/flow/call-graph
 * Scanner Registry phases scoped to this repo root. Mirrors the single-repo
 * pipeline but with projectRoot = repoRoot and repoSlug set on every module.
 */
async function scanWorkspaceJavaRepo(
  repo: WorkspaceRepo,
  repoRoot: string,
  config: ArchConfig,
  acc: WorkspaceAccumulator
): Promise<void> {
  if (!config.scanners.java) return;

  const repoModules = await findMavenModules(repoRoot, repo.slug);
  const pathRules = await resolveJavaPathRules(repoRoot, config);
  await writePathRulesSnapshot(repoRoot, pathRules);
  const { apis: repoApis, rpcs: repoRpcs } = await scanJavaSources(
    repoRoot,
    repoModules,
    pathRules,
    config
  );

  acc.modules.push(...repoModules);
  acc.apis.push(...repoApis);
  acc.rpcs.push(...repoRpcs);

  const registry = createScannerRegistry();
  const repoModel: DocumentModel = {
    modules: repoModules,
    apis: repoApis,
    rpcs: repoRpcs,
    packages: [],
  };
  const ctx: ScannerContext = {
    projectRoot: repoRoot,
    modules: repoModules,
    model: repoModel,
    repoLang: "java",
    repoSlug: repo.slug,
  };

  // Entity phase: JPA > MyBatis > SQL, then collect entity names for flows.
  const entityNames = new Set<string>();
  const entityResults: Record<
    string,
    { entities: EntityDef[]; relations: EntityRelation[] }
  > = {};
  for (const plugin of registry) {
    if (plugin.phase !== "entity") continue;
    try {
      const result = await plugin.scan(ctx);
      if (result.entities?.entities) {
        entityResults[plugin.name] = {
          entities: result.entities.entities,
          relations: result.entities.relations ?? [],
        };
      }
    } catch (e) {
      archLog.warn(`start-init: ${plugin.name} failed (non-fatal)`, {
        repo: repo.slug,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  try {
    const merged = mergeEntityGraphs(
      entityResults["entity-jpa"] ?? { entities: [], relations: [] },
      entityResults["entity-mybatis"] ?? { entities: [], relations: [] },
      entityResults["entity-sql"] ?? { entities: [], relations: [] }
    );
    if (merged.entities.length > 0) {
      acc.entityDefs.push(...merged.entities);
      acc.entityRelations.push(...merged.relations);
      for (const e of merged.entities) entityNames.add(e.name);
    }
  } catch (e) {
    archLog.warn("start-init: workspace entity merge failed (non-fatal)", {
      repo: repo.slug,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Flow phase: derive cross-layer flows from the entities of this repo.
  if (entityNames.size > 0) {
    const flowCtx: ScannerContext = { ...ctx, entityNames: [...entityNames] };
    for (const plugin of registry) {
      if (plugin.phase !== "flow") continue;
      try {
        const result = await plugin.scan(flowCtx);
        if (result.flows?.nodes && result.flows.nodes.length > 0) {
          acc.flowNodes.push(...result.flows.nodes);
          acc.flowEdges.push(...(result.flows.edges ?? []));
        }
      } catch (e) {
        archLog.warn(`start-init: ${plugin.name} failed (non-fatal)`, {
          repo: repo.slug,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // Call-graph phase: Java method/DTO graph for this repo.
  for (const plugin of registry) {
    if (plugin.phase !== "call-graph") continue;
    try {
      const result = await plugin.scan(ctx);
      if (result.callGraph?.nodes && result.callGraph.nodes.length > 0) {
        acc.callNodes.push(...result.callGraph.nodes);
        acc.callEdges.push(...result.callGraph.edges);
      }
    } catch (e) {
      archLog.warn(`start-init: ${plugin.name} failed (non-fatal)`, {
        repo: repo.slug,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

/**
 * Go repo: one scanGoSources pass, then its APIs/structs/methods are converted
 * into the unified model shapes. ApiEndpoint has no repoSlug field in v2.1.0,
 * so the moduleSlug (== repo slug) carries repo attribution.
 */
async function scanWorkspaceGoRepo(
  repo: WorkspaceRepo,
  repoRoot: string,
  acc: WorkspaceAccumulator
): Promise<void> {
  const result = await scanGoSources(repoRoot, repo.slug);

  // GoModule is structurally compatible with JavaModule (slug/name/path +
  // repoSlug), so it merges directly into the unified module list.
  acc.modules.push(...result.modules);

  for (const goApi of result.apis) {
    acc.apis.push({
      id: goApi.id,
      method: goApi.method,
      path: goApi.path,
      summary: `${goApi.method} ${goApi.path}`,
      tags: [],
      audience: goApi.path.includes("/internal") ? "internal" : "frontend-facing",
      source: "java",
      moduleSlug: goApi.moduleSlug,
    });
  }

  // Go structs -> entities (same conversion as the registry go-scanner plugin).
  for (const s of result.structs) {
    acc.entityDefs.push({
      name: s.name,
      table: s.name,
      moduleSlug: s.moduleSlug,
      filePath: s.filePath,
      fields: s.fields.map((f) => ({ name: f.name, type: f.type })),
      source: "sql",
    });
  }

  // Go methods + call edges -> call graph.
  for (const m of result.methods) {
    acc.callNodes.push({
      id: m.id,
      kind: "method",
      name: m.receiver ? `${m.receiver}.${m.name}` : m.name,
      filePath: m.filePath,
      moduleSlug: m.moduleSlug,
      signature: m.signature,
    });
  }
  for (const e of result.callEdges) {
    acc.callEdges.push({
      from: e.source,
      to: e.target,
      kind: "calls",
      confidence: "high",
    });
  }
}

/** Python repo: one scanPythonSources pass, converted into the unified shapes. */
async function scanWorkspacePythonRepo(
  repo: WorkspaceRepo,
  repoRoot: string,
  acc: WorkspaceAccumulator
): Promise<void> {
  const result = await scanPythonSources(repoRoot, repo.slug);

  // PythonModule is structurally compatible with JavaModule.
  acc.modules.push(...result.modules);

  for (const pyApi of result.apis) {
    acc.apis.push({
      id: pyApi.id,
      method: pyApi.method,
      path: pyApi.path,
      summary: `${pyApi.method} ${pyApi.path}`,
      tags: [],
      audience: pyApi.path.includes("/internal") ? "internal" : "frontend-facing",
      source: "java",
      moduleSlug: pyApi.moduleSlug,
    });
  }

  // Python ORM classes -> entities.
  for (const c of result.classes) {
    if (c.ormType === "none") continue;
    acc.entityDefs.push({
      name: c.name,
      table: c.tableName ?? c.name,
      moduleSlug: c.moduleSlug,
      filePath: c.filePath,
      fields: c.fields.map((f) => ({ name: f.name, type: f.type })),
      source: "sql",
    });
  }

  for (const m of result.methods) {
    acc.callNodes.push({
      id: m.id,
      kind: "method",
      name: m.className ? `${m.className}.${m.name}` : m.name,
      filePath: m.filePath,
      moduleSlug: m.moduleSlug,
      signature: m.signature,
    });
  }
  for (const e of result.callEdges) {
    acc.callEdges.push({
      from: e.source,
      to: e.target,
      kind: "calls",
      confidence: "high",
    });
  }
}

/**
 * TS repo: scanFrontend discovers packages, then the frontend call-graph
 * registry plugin runs scoped to this repo root.
 */
async function scanWorkspaceTsRepo(
  repo: WorkspaceRepo,
  repoRoot: string,
  config: ArchConfig,
  acc: WorkspaceAccumulator
): Promise<void> {
  if (!config.scanners.frontend) return;

  const repoPackages = await scanFrontend(repoRoot, repo.slug);
  acc.packages.push(...repoPackages);
  for (const pkg of repoPackages) {
    acc.packageDirs.set(pkg.slug, repoRoot);
  }

  const registry = createScannerRegistry();
  const ctx: ScannerContext = {
    projectRoot: repoRoot,
    modules: [],
    model: { modules: [], apis: [], rpcs: [], packages: repoPackages },
    repoLang: "ts",
    repoSlug: repo.slug,
    packageDirs: acc.packageDirs,
    packages: repoPackages,
  };
  for (const plugin of registry) {
    if (plugin.phase !== "call-graph") continue;
    try {
      const result = await plugin.scan(ctx);
      if (result.callGraph?.nodes && result.callGraph.nodes.length > 0) {
        acc.callNodes.push(...result.callGraph.nodes);
        acc.callEdges.push(...result.callGraph.edges);
      }
    } catch (e) {
      archLog.warn(`start-init: ${plugin.name} failed (non-fatal)`, {
        repo: repo.slug,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
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

  // v2.1.0: workspace mode -- when apt-workspace.json is present, scan every
  // listed repo and merge results. Single-repo mode below is unchanged.
  const workspaceConfig = await loadWorkspace(projectRoot);
  if (workspaceConfig) {
    return await runWorkspaceInit(
      projectRoot,
      workspaceConfig,
      config,
      deps,
      options
    );
  }
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
  let pathRulesHash: string | undefined;
  if (config.scanners.java) {
    javaPathRules = await resolveJavaPathRules(projectRoot, config);
    pathRulesHash = computePathRulesHash(javaPathRules);
    await writePathRulesSnapshot(projectRoot, javaPathRules);
    archLog.info("start-init: java path rules", {
      confidence: javaPathRules.confidence,
      contextPath: javaPathRules.contextPath || "(none)",
      prefixCount: javaPathRules.controllerPrefixes.length,
      prefixes: javaPathRules.controllerPrefixes.map((r) => ({
        prefix: r.prefix,
        pattern: r.controllerPattern,
        source: r.source,
      })),
      pathRulesHash,
    });
    if (
      incremental &&
      previousScan?.pathRulesHash &&
      previousScan.pathRulesHash !== pathRulesHash
    ) {
      archLog.warn(
        "start-init: path rules changed since last scan; run start-init --reindex-apis to refresh API paths",
        {
          previousHash: previousScan.pathRulesHash,
          currentHash: pathRulesHash,
        }
      );
    }
  }
  const { apis: javaApis, rpcs } = config.scanners.java
    ? await scanJavaSources(projectRoot, modules, javaPathRules, config)
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

  // v2.0.4: Entity + Flow scanning via Scanner Registry
  const entityNames = new Set<string>();
  if (config.scanners.java) {
    const registry = createScannerRegistry();
    const ctx: ScannerContext = { projectRoot, modules, model };

    // Entity phase: collect results from all entity-phase plugins
    const entityResults: Record<string, { entities: EntityDef[]; relations: EntityRelation[] }> = {};
    for (const plugin of registry) {
      if (plugin.phase !== "entity") continue;
      try {
        const result = await plugin.scan(ctx);
        if (result.entities?.entities) {
          entityResults[plugin.name] = {
            entities: result.entities.entities,
            relations: result.entities.relations ?? [],
          };
        }
      } catch (e) {
        archLog.warn(`start-init: ${plugin.name} failed (non-fatal)`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Merge entity graphs (JPA > MyBatis > SQL)
    try {
      const merged = mergeEntityGraphs(
        entityResults["entity-jpa"] ?? { entities: [], relations: [] },
        entityResults["entity-mybatis"] ?? { entities: [], relations: [] },
        entityResults["entity-sql"] ?? { entities: [], relations: [] },
      );
      if (merged.entities.length > 0) {
        model.entities = merged;
        for (const e of merged.entities) entityNames.add(e.name);
        archLog.info("start-init: entity scan complete", {
          entities: merged.entities.length,
          relations: merged.relations.length,
        });
      }
    } catch (e) {
      archLog.warn("start-init: entity merge failed (non-fatal)", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Flow phase: run flow-phase plugins with entityNames populated
    if (entityNames.size > 0) {
      const flowCtx: ScannerContext = { ...ctx, entityNames: [...entityNames] };
      for (const plugin of registry) {
        if (plugin.phase !== "flow") continue;
        try {
          const result = await plugin.scan(flowCtx);
          if (result.flows?.nodes && result.flows.nodes.length > 0) {
            model.flows = {
              nodes: result.flows.nodes,
              edges: result.flows.edges ?? [],
            };
            archLog.info(`start-init: ${plugin.name} complete`, {
              nodes: model.flows.nodes.length,
              edges: model.flows.edges.length,
            });
          }
        } catch (e) {
          archLog.warn(`start-init: ${plugin.name} failed (non-fatal)`, {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  if (!incremental) {
    archLog.info("start-init: writing base markdown and index");
    await writeMarkdownTree(projectRoot, model);
    const index = buildArchIndex(model);
    await writeArchIndex(projectRoot, index);
  }

  const packageDirs = config.scanners.frontend
    ? await resolveFrontendPackageDirs(projectRoot, config.frontendPackages)
    : new Map<string, string>();

  // v2.0.5: Call graph scanning via registry. Runs after packageDirs is
  // resolved because the frontend plugin needs it. The registry/ctx here are
  // the same shape as the entity/flow phase above; a fresh registry is used
  // since the earlier one is scoped inside the `config.scanners.java` block.
  {
    const registry = createScannerRegistry();
    const ctx: ScannerContext = { projectRoot, modules, model };
    const callCtx: ScannerContext = { ...ctx, packageDirs, packages: model.packages };
    for (const plugin of registry) {
      if (plugin.phase !== "call-graph") continue;
      try {
        const result = await plugin.scan(callCtx);
        if (result.callGraph?.nodes && result.callGraph.nodes.length > 0) {
          if (!model.callGraph) {
            model.callGraph = { nodes: [], edges: [] };
          }
          model.callGraph.nodes.push(...result.callGraph.nodes);
          model.callGraph.edges.push(...result.callGraph.edges);
          archLog.info(`start-init: ${plugin.name} complete`, {
            nodes: result.callGraph.nodes.length,
            edges: result.callGraph.edges.length,
          });
        }
      } catch (e) {
        archLog.warn(`start-init: ${plugin.name} failed (non-fatal)`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

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

  // v2.0.3: persist entity/flow docs after the markdown index is final.
  if (model.entities) {
    try {
      await writeEntityDocs(projectRoot, model.entities);
    } catch (e) {
      archLog.warn("start-init: entity doc write failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (model.flows) {
    try {
      await writeFlowDocs(projectRoot, model.flows);
    } catch (e) {
      archLog.warn("start-init: flow doc write failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (model.callGraph) {
    try {
      await writeCallGraph(projectRoot, model.callGraph);
    } catch (e) {
      archLog.warn("start-init: call-graph doc write failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
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
      branch,
      pathRulesHash
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

export {
  runReindexApis,
  type ReindexApisReport,
  type ReindexApisDeps,
} from "./reindex/apis.js";
