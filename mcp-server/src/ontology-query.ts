// Core handler for the `query_ontology` MCP tool. Two modes:
//   - snapshot (no topic): a project-wide ontology overview
//   - focus   (topic set): everything that matches a single topic across layers
// Fault-tolerant by design: the only hard error is a missing arch-index.json
// (project not initialized). Every subfield is computed behind its own
// try/catch so a single failing source never breaks the whole response.
import fs from "node:fs/promises";
import path from "node:path";
import { aggregateStatus } from "./status/aggregate.js";
import { handleSearchArch } from "./arch-query.js";
import { readDb } from "./db.js";
import { listArchModules, listArchPackages } from "./ontology/asset-counter.js";
import type {
  ProjectOntology,
  OntologyTopicResult,
  ProjectMeta,
  OntologyStatus,
  OntologyProgress,
  OntologyDesign,
  OntologyApprovalState,
  OntologyContract,
  ModuleOntology,
  PackageOntology,
  OntologyTopology,
} from "./ontology/types.js";
import {
  loadOrInitConfig,
  getArchIndexPath,
  getDesignDir,
  getDesignProfilePath,
  getFrameworkBindingsPath,
  getArchDir,
  loadWorkspace,
  loadArchIndex,
  type SearchHit,
  type EntityRelation,
  type ArchIndex,
} from "@apt/arch-engine";

const PROGRESS_REL = path.join(".apt", "orchestration", "progress.md");
const DESIGN_TOKENS_DIR = "tokens";
const DESIGN_PAGES_DIR = "pages";
const DESIGN_COMPONENTS_DIR = "components";

export async function handleQueryOntology(
  projectRoot: string,
  topic?: string
): Promise<ProjectOntology | OntologyTopicResult | { error: string }> {
  try {
    // Entry guard: arch-index.json is the only hard error. A project without an
    // architecture index cannot answer any ontology question.
    try {
      await fs.access(getArchIndexPath(projectRoot));
    } catch {
      return { error: "project not initialized; run start-init first" };
    }

    if (topic && topic.trim().length > 0) {
      return await queryTopic(projectRoot, topic.trim());
    }
    return await querySnapshot(projectRoot);
  } catch (err) {
    return {
      error: `ontology query failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

// ---------------------------------------------------------------------------
// Snapshot mode
// ---------------------------------------------------------------------------

type AggregatedStatus = Awaited<ReturnType<typeof aggregateStatus>>;

async function querySnapshot(
  projectRoot: string
): Promise<ProjectOntology> {
  // project: created===true means the config was just scaffolded (no real
  // projectMeta), so surface null instead of a phantom default.
  let project: ProjectMeta | null = null;
  try {
    const { config, created } = await loadOrInitConfig(projectRoot);
    if (!created) project = config.projectMeta ?? null;
  } catch {
    project = null;
  }

  // status: prefer aggregateStatus (read-only) over handleQueryProjectStatus
  // (which writes a snapshot back) to avoid side effects.
  let status: OntologyStatus;
  let st: AggregatedStatus | undefined;
  try {
    st = await aggregateStatus(projectRoot);
    status = {
      phase: st.phase,
      loopDone: st.loopDone,
      nextAction: st.nextAction,
    };
    if (st.goal !== undefined) status.activeGoal = st.goal;
  } catch {
    status = { phase: "idle", loopDone: false, nextAction: "none" };
  }

  // progress: only emitted when the task ledger has real entries.
  const progress = await deriveProgress(projectRoot, st?.tasks);

 let modules: ModuleOntology[] = [];
 try {
   modules = await listArchModules(projectRoot);
 } catch {
   modules = [];
 }

  // v2.1.0: enrich each module with repoSlug from the arch-index node, then
  // group modules by repoSlug so same-repo entries are adjacent in the output.
  // Both steps are best-effort: any failure leaves modules untouched.
  try {
    const index: ArchIndex = await loadArchIndex(projectRoot);
    let hasRepo = false;
    for (const mod of modules) {
      const rawNode = index.nodes[`backend/${mod.slug}`] as
        | (ArchIndex["nodes"][string] & { repoSlug?: unknown })
        | undefined;
      if (rawNode && typeof rawNode.repoSlug === "string" && rawNode.repoSlug.length > 0) {
        mod.repoSlug = rawNode.repoSlug;
        hasRepo = true;
      }
    }
    if (hasRepo) {
      // Stable group sort: by repoSlug then by slug (modules without a repoSlug
      // sort last with an empty-string key).
      modules.sort((a, b) => {
        const ra = a.repoSlug ?? "";
        const rb = b.repoSlug ?? "";
        if (ra !== rb) return ra < rb ? -1 : 1;
        return a.slug < b.slug ? -1 : 1;
      });
    }
  } catch {
    // arch-index unreadable: repoSlug left unset, original order preserved.
  }

  let packages: PackageOntology[] = [];
  try {
    packages = await listArchPackages(projectRoot);
  } catch {
    packages = [];
  }

  let contracts: OntologyContract[] = [];
  try {
    const db = await readDb(projectRoot);
    contracts = db.contracts.map((c) => ({
      name: c.name,
      tsFile: c.tsFilePath,
    }));
  } catch {
    contracts = [];
  }

  // design + approvalState never throw into the caller; failure omits the field.
  const design = await readDesignInfo(projectRoot);
  const approvalState = deriveApprovalState(st);

  // v2.0.3: relations from entities.json (silent omit on failure)
  let relations: EntityRelation[] | undefined;
  try {
    const entitiesJsonPath = path.join(getArchDir(projectRoot), "entities.json");
    const raw = await fs.readFile(entitiesJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as { relations?: EntityRelation[] };
    if (parsed.relations && parsed.relations.length > 0) {
      relations = parsed.relations;
    }
  } catch {
    // entities.json missing or corrupt — relations field omitted silently
  }

  const ontology: ProjectOntology = {
    project,
    status,
    modules,
    packages,
    contracts,
  };
  if (progress) ontology.progress = progress;
  if (design) ontology.design = design;
  if (approvalState) ontology.approvalState = approvalState;
  if (relations) ontology.relations = relations;
  // v2.0.4: structural topology metrics (entities/flow). Omitted only when the
  // whole computation fails; zero counts are valid and kept.
  const topology = await deriveTopology(projectRoot, modules);
  if (topology) ontology.topology = topology;
  return ontology;
}

// v2.0.4: structural topology metrics for the snapshot. Each source (entities,
// flow) is behind its own try/catch so a missing or corrupt file yields a zero
// count rather than omitting the whole topology; only a total failure returns
// undefined. moduleCount comes from the already-computed modules list.
async function deriveTopology(
  projectRoot: string,
  modules: ModuleOntology[]
): Promise<OntologyTopology | undefined> {
  try {
    const archDir = getArchDir(projectRoot);
    const moduleCount = modules.length;

    // entityCount: entities.json; missing/corrupt -> 0 (a valid value).
    let entityCount = 0;
    try {
      const entitiesRaw = await fs.readFile(
        path.join(archDir, "entities.json"),
        "utf-8"
      );
      const entitiesParsed = JSON.parse(entitiesRaw) as {
        entities?: unknown[];
      };
      entityCount = Array.isArray(entitiesParsed.entities)
        ? entitiesParsed.entities.length
        : 0;
    } catch {
      entityCount = 0;
    }

    // flowEdgeCount / rpcEndpoints / crossServiceRefs: flow.json; missing/corrupt
    // -> all stay 0. rpcEndpoints counts rpc-layer nodes; crossServiceRefs
    // counts edges that touch an rpc node (ids are prefixed "rpc:").
    let flowEdgeCount = 0;
    let rpcEndpoints = 0;
    let crossServiceRefs = 0;
    try {
      const flowRaw = await fs.readFile(path.join(archDir, "flow.json"), "utf-8");
      const flowParsed = JSON.parse(flowRaw) as {
        nodes?: { layer?: string }[];
        edges?: { from?: string; to?: string }[];
      };
      flowEdgeCount = Array.isArray(flowParsed.edges)
        ? flowParsed.edges.length
        : 0;
      const rpcNodes = Array.isArray(flowParsed.nodes)
        ? flowParsed.nodes.filter((n) => n?.layer === "rpc")
        : [];
      rpcEndpoints = rpcNodes.length;
      if (Array.isArray(flowParsed.edges)) {
        crossServiceRefs = flowParsed.edges.filter(
          (e) =>
            e?.from?.startsWith("rpc:") || e?.to?.startsWith("rpc:")
        ).length;
      }
    } catch {
      // flow.json missing or corrupt: all flow counts stay 0.
    }
    // v2.0.5: call-graph metrics from call-graph.json; missing/corrupt -> all
    // stay 0. methodCount counts only real method nodes (id prefix "method:"),
    // excluding frontend components which share kind "method" at runtime but
    // use a "component:" id. importEdgeCount covers both "imports" and
    // "template" edges (both are module/import boundary crossings).
    let methodCount = 0;
    let dtoCount = 0;
    let callEdgeCount = 0;
    let importEdgeCount = 0;
    try {
      const cgRaw = await fs.readFile(
        path.join(archDir, "call-graph.json"),
        "utf-8"
      );
      const cgParsed = JSON.parse(cgRaw) as {
        nodes?: { id?: string; kind?: string }[];
        edges?: { kind?: string }[];
      };
      const cgNodes = Array.isArray(cgParsed.nodes) ? cgParsed.nodes : [];
      const cgEdges = Array.isArray(cgParsed.edges) ? cgParsed.edges : [];
      methodCount = cgNodes.filter(
        (n) =>
          n?.kind === "method" &&
          typeof n.id === "string" &&
          n.id.startsWith("method:")
      ).length;
      dtoCount = cgNodes.filter((n) => n?.kind === "dto").length;
      callEdgeCount = cgEdges.filter((e) => e?.kind === "calls").length;
      importEdgeCount = cgEdges.filter(
        (e) => e?.kind === "imports" || e?.kind === "template"
      ).length;
    } catch {
      // call-graph.json missing or corrupt: all call-graph counts stay 0.
    }

    const topology: OntologyTopology = {
      moduleCount,
      rpcEndpoints,
      entityCount,
      flowEdgeCount,
      crossServiceRefs,
      methodCount,
      dtoCount,
      callEdgeCount,
      importEdgeCount,
    };

    // v2.1.0: repoCount from apt-workspace.json manifest. When no manifest is
    // present (single-repo mode), fall back to distinct module repoSlugs from
    // the arch-index. Omitted entirely when neither source yields a count.
    try {
      const workspace = await loadWorkspace(projectRoot);
      if (workspace && workspace.repos.length > 0) {
        topology.repoCount = workspace.repos.length;
      } else {
        const distinctRepos = new Set<string>();
        for (const m of modules) {
          if (m.repoSlug) distinctRepos.add(m.repoSlug);
        }
        if (distinctRepos.size > 0) topology.repoCount = distinctRepos.size;
      }
    } catch {
      // workspace manifest missing/corrupt and no module repoSlugs: omit.
    }

    return topology;
  } catch {
    // Overall failure: omit topology entirely.
    return undefined;
  }
}

// progress requires real tasks; an empty/missing ledger omits the field rather
// than surfacing a {0,0} placeholder. currentTask is a light read of the first
// unchecked checkbox line in progress.md.
async function deriveProgress(
  projectRoot: string,
  tasks: AggregatedStatus["tasks"]
): Promise<OntologyProgress | undefined> {
  if (!tasks || tasks.total === 0) return undefined;
  const progress: OntologyProgress = {
    doneCount: tasks.done,
    totalCount: tasks.total,
  };
  try {
    const text = await fs.readFile(
      path.join(projectRoot, PROGRESS_REL),
      "utf-8"
    );
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*[-*+]\s*\[\s\]\s+(.+)$/);
      if (match && match[1]) {
        progress.currentTask = match[1].trim();
        break;
      }
    }
  } catch {
    // currentTask is best-effort; leave it unset.
  }
  return progress;
}

// approvalState reuses what aggregateStatus already computed (specRisk +
// specApproval) instead of re-reading approvals.json / risk.ts. Omitted when
// neither value is present.
function deriveApprovalState(
  st: AggregatedStatus | undefined
): OntologyApprovalState | undefined {
  if (!st) return undefined;
  if (st.specRisk === undefined && st.specApproval === undefined) {
    return undefined;
  }
  return { specRisk: st.specRisk, state: st.specApproval };
}

// ---------------------------------------------------------------------------
// Topic (focus) mode
// ---------------------------------------------------------------------------

async function queryTopic(
  projectRoot: string,
  topic: string
): Promise<OntologyTopicResult> {
  const topicLower = topic.toLowerCase();

  // handleSearchArch depends on embeddings / a vector db and will throw when
  // those are unavailable; degrade to an empty list instead of failing.
  let assets: SearchHit[] = [];
  try {
    assets = await handleSearchArch(projectRoot, topic, 10);
  } catch {
    assets = [];
  }

  let contracts: OntologyContract[] = [];
  try {
    const db = await readDb(projectRoot);
    contracts = db.contracts
      .filter((c) => c.name.toLowerCase().includes(topicLower))
      .map((c) => ({ name: c.name, tsFile: c.tsFilePath }));
  } catch {
    contracts = [];
  }

  // designPages only when a design layer exists; otherwise the field is omitted.
  const design = await readDesignInfo(projectRoot);
  let designPages: string[] | undefined;
  if (design) {
    designPages = design.pages.filter((slug) =>
      slug.toLowerCase().includes(topicLower)
    );
  }

  // v2.0.4: Entity + flow drill-down. When the topic matches a module slug,
  // surface that module's entity names and a flow node/edge summary. Missing
  // or corrupt entities.json/flow.json omits the fields silently.
  const archDir = getArchDir(projectRoot);
  let entities: string[] | undefined;
  let flowSummary: { nodes: number; edges: number } | undefined;
  try {
    const entitiesRaw = await fs.readFile(
      path.join(archDir, "entities.json"),
      "utf-8"
    );
    const entitiesParsed = JSON.parse(entitiesRaw) as {
      entities?: { moduleSlug?: string; name?: string }[];
    };
    const moduleEntities = (entitiesParsed.entities ?? [])
      .filter((e) => e?.moduleSlug?.toLowerCase() === topicLower)
      .map((e) => e.name)
      .filter((n): n is string => typeof n === "string");
    if (moduleEntities.length > 0) {
      entities = moduleEntities;
    }
  } catch {
    // entities.json missing/corrupt: entities omitted silently.
  }
  try {
    const flowRaw = await fs.readFile(path.join(archDir, "flow.json"), "utf-8");
    const flowParsed = JSON.parse(flowRaw) as {
      nodes?: { moduleSlug?: string }[];
      edges?: unknown[];
    };
    const moduleNodes = (flowParsed.nodes ?? []).filter(
      (n) => n?.moduleSlug?.toLowerCase() === topicLower
    );
    if (moduleNodes.length > 0) {
      flowSummary = {
        nodes: moduleNodes.length,
        edges: flowParsed.edges?.length ?? 0,
      };
    }
  } catch {
    // flow.json missing/corrupt: flowSummary omitted silently.
  }
  // v2.0.5: call-graph method/DTO drill-down. When the topic matches a module
  // slug, count that module's methods (id prefix "method:", excluding frontend
  // components which share kind "method") and DTOs from call-graph.json.
  // Missing/corrupt call-graph.json omits both fields silently.
  let methods: number | undefined;
  let dtos: number | undefined;
  try {
    const cgRaw = await fs.readFile(
      path.join(archDir, "call-graph.json"),
      "utf-8"
    );
    const cgParsed = JSON.parse(cgRaw) as {
      nodes?: { id?: string; kind?: string; moduleSlug?: string }[];
    };
    const cgNodes = Array.isArray(cgParsed.nodes) ? cgParsed.nodes : [];
    const moduleMethods = cgNodes.filter(
      (n) =>
        n?.kind === "method" &&
        typeof n.id === "string" &&
        n.id.startsWith("method:") &&
        n?.moduleSlug?.toLowerCase() === topicLower
    ).length;
    const moduleDtos = cgNodes.filter(
      (n) => n?.kind === "dto" && n?.moduleSlug?.toLowerCase() === topicLower
    ).length;
    if (moduleMethods > 0) methods = moduleMethods;
    if (moduleDtos > 0) dtos = moduleDtos;
  } catch {
    // call-graph.json missing/corrupt: methods/dtos omitted silently.
  }

  const matchedIn: string[] = [];
  if (assets.length > 0) matchedIn.push("architecture");
  if (contracts.length > 0) matchedIn.push("contracts");
  if (designPages && designPages.length > 0) matchedIn.push("design");
  if (entities || flowSummary || methods !== undefined || dtos !== undefined)
    matchedIn.push("ontology");

  const result: OntologyTopicResult = {
    topic,
    matchedIn,
    assets,
    contracts,
  };
  if (designPages) result.designPages = designPages;
  if (entities) result.entities = entities;
  if (flowSummary) result.flowSummary = flowSummary;
  if (methods !== undefined) result.methods = methods;
  if (dtos !== undefined) result.dtos = dtos;
  return result;
}

// ---------------------------------------------------------------------------
// Shared design-layer detection
// ---------------------------------------------------------------------------

// The design layer counts as present when it has any token file or a
// profile.json. hasBindings is tracked separately (framework-bindings.json).
// page/component slugs are *.json basenames (extension stripped). Any failure
// omits the whole field rather than surfacing a partial view.
async function readDesignInfo(
  projectRoot: string
): Promise<OntologyDesign | undefined> {
  try {
    const designDir = getDesignDir(projectRoot);
    const tokenSlugs = await listJsonBasenames(
      path.join(designDir, DESIGN_TOKENS_DIR)
    );
    const hasTokens = tokenSlugs.length > 0;

    let profileExists = false;
    try {
      await fs.access(getDesignProfilePath(projectRoot));
      profileExists = true;
    } catch {
      profileExists = false;
    }
    if (!hasTokens && !profileExists) return undefined;

    let hasBindings = false;
    try {
      await fs.access(getFrameworkBindingsPath(projectRoot));
      hasBindings = true;
    } catch {
      hasBindings = false;
    }

    const pages = await listJsonBasenames(
      path.join(designDir, DESIGN_PAGES_DIR)
    );
    const components = await listJsonBasenames(
      path.join(designDir, DESIGN_COMPONENTS_DIR)
    );

    return { hasTokens, hasBindings, pages, components };
  } catch {
    return undefined;
  }
}

async function listJsonBasenames(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.slice(0, -".json".length))
    .sort();
}
