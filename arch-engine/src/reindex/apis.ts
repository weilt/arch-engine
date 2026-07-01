import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { chunkStructuredEntities } from "../chunking/semantic.js";
import { loadOrInitConfig, resolveApiKey } from "../config.js";
import { embedTexts } from "../embedding/openai-compatible.js";
import { readLastScan, writeLastScan } from "../incremental/last-scan.js";
import { archLog } from "../log.js";
import { getArchDir, getVectorsDbPath } from "../paths.js";
import { scanFrontend } from "../scanners/frontend.js";
import {
  findMavenModules,
  scanJavaSources,
} from "../scanners/java.js";
import {
  resolveJavaPathRules,
  type ResolvedJavaPathRules,
} from "../scanners/java-path-rules.js";
import { mergeDocumentModel } from "../scanners/merge.js";
import { scanOpenApiGlobs } from "../scanners/openapi.js";
import { deriveFlowGraph } from "../scanners/flow-scanner.js";
import type { ArchConfig, DocumentModel, EntityGraph } from "../types.js";
import { VectorStore } from "../vector/sqlite-store.js";
import {
  loadArchIndex,
  writeArchIndex,
  writeIndexMd,
  writePathRulesSnapshot,
} from "../writer/index.js";
import { patchArchIndexApiNodes } from "../writer/arch-index.js";
import { writeApiDocsForModel } from "../writer/markdown.js";
import { writeFlowDocs } from "../writer/flow-md.js";

export interface ReindexApisReport {
  apiCount: number;
  modulesUpdated: number;
}

export interface ReindexApisDeps {
  /** Inject for tests; defaults to embedTexts. */
  embedTextsFn?: (config: ArchConfig, texts: string[]) => Promise<number[][]>;
}

function computePathRulesHash(resolved: ResolvedJavaPathRules): string {
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

export async function runReindexApis(
  projectRoot: string,
  deps: ReindexApisDeps = {}
): Promise<ReindexApisReport> {
  archLog.info("reindex-apis: begin", { projectRoot });

  const { config, created } = await loadOrInitConfig(projectRoot);
  if (created) {
    throw new Error(
      "arch.config.json was just created; run start-init before reindex-apis"
    );
  }

  resolveApiKey(config, "embedding");

  let pathRulesHash: string | undefined;
  let javaPathRules: Awaited<ReturnType<typeof resolveJavaPathRules>> | undefined;

  if (config.scanners.java) {
    javaPathRules = await resolveJavaPathRules(projectRoot, config);
    pathRulesHash = computePathRulesHash(javaPathRules);
    await writePathRulesSnapshot(projectRoot, javaPathRules);
    archLog.info("reindex-apis: path rules", {
      confidence: javaPathRules.confidence,
      prefixCount: javaPathRules.controllerPrefixes.length,
      pathRulesHash,
    });
  }

  const modules = config.scanners.java ? await findMavenModules(projectRoot) : [];
  const { apis: javaApis, rpcs } = config.scanners.java
    ? await scanJavaSources(projectRoot, modules, javaPathRules, config)
    : { apis: [], rpcs: [] };
  const openApis = await scanOpenApiGlobs(projectRoot, config.apiSpecGlobs);
  const packages = config.scanners.frontend ? await scanFrontend(projectRoot) : [];
  const model = mergeDocumentModel(javaApis, openApis, rpcs, modules, packages);

  archLog.info("reindex-apis: scan complete", {
    apis: model.apis.length,
    modules: model.modules.length,
  });

  const modulesUpdated = await writeApiDocsForModel(projectRoot, model);

  const index = await loadArchIndex(projectRoot);
  patchArchIndexApiNodes(index, model);
  await writeArchIndex(projectRoot, index);
  await writeIndexMd(projectRoot, index);

  const apiChunks = chunkStructuredEntities(model).filter((c) => c.kind === "api");
  const modulesWithApis = new Set(model.apis.map((a) => a.moduleSlug));

  const store = new VectorStore(getVectorsDbPath(projectRoot));
  try {
    for (const slug of modulesWithApis) {
      store.deleteChunksByKindAndPathPrefix("api", `backend/${slug}/api`);
    }

    if (apiChunks.length > 0) {
      const embedFn = deps.embedTextsFn ?? embedTexts;
      const embeddings = await embedFn(
        config,
        apiChunks.map((c) => c.text)
      );
      store.upsertChunks(
        apiChunks.map((c, i) => ({ meta: c, embedding: embeddings[i]! }))
      );
    }

    patchArchIndexApiNodes(index, model, apiChunks);
    await writeArchIndex(projectRoot, index);
  } finally {
    store.close();
  }

  await refreshFlowDocsIfEntitiesExist(projectRoot, model);

  if (pathRulesHash !== undefined) {
    const previousScan = await readLastScan(projectRoot);
    if (previousScan) {
      await writeLastScan(projectRoot, { ...previousScan, pathRulesHash });
    }
  }

  archLog.info("reindex-apis: done", {
    apiCount: model.apis.length,
    modulesUpdated,
  });

  return { apiCount: model.apis.length, modulesUpdated };
}

async function refreshFlowDocsIfEntitiesExist(
  projectRoot: string,
  model: DocumentModel
): Promise<void> {
  const entitiesPath = path.join(getArchDir(projectRoot), "entities.json");
  try {
    await fs.access(entitiesPath);
  } catch {
    return;
  }

  try {
    const raw = await fs.readFile(entitiesPath, "utf-8");
    const graph = JSON.parse(raw) as EntityGraph;
    const entityNames = graph.entities.map((e) => e.name);
    if (entityNames.length === 0) return;

    const flows = await deriveFlowGraph(projectRoot, entityNames, model);
    await writeFlowDocs(projectRoot, flows);
    archLog.info("reindex-apis: flow docs refreshed", {
      entities: entityNames.length,
      flowNodes: flows.nodes.length,
    });
  } catch (e) {
    archLog.warn("reindex-apis: flow refresh failed (non-fatal)", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
