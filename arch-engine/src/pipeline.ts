import fs from "node:fs/promises";
import path from "node:path";
import { loadOrInitConfig, resolveApiKey } from "./config.js";
import { archLog } from "./log.js";
import { buildAllChunks } from "./chunking/semantic.js";
import { embedTexts } from "./embedding/openai-compatible.js";
import { getArchDir, getVectorsDbPath } from "./paths.js";
import { scanFrontend } from "./scanners/frontend.js";
import { findMavenModules, scanJavaSources } from "./scanners/java.js";
import { mergeDocumentModel } from "./scanners/merge.js";
import { scanOpenApiGlobs } from "./scanners/openapi.js";
import type { DocumentModel } from "./types.js";
import { VectorStore } from "./vector/sqlite-store.js";
import {
  attachChunksToIndex,
  buildArchIndex,
  writeArchIndex,
  writeIndexMd,
  writeMarkdownTree,
} from "./writer/index.js";

export type StartInitReport =
  | { status: "config-created" }
  | {
      status: "ok";
      chunkCount: number;
      apiCount: number;
      moduleCount: number;
    };

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
  model: DocumentModel
): Promise<Map<string, string>> {
  const archDir = getArchDir(projectRoot);
  const map = new Map<string, string>();

  for (const mod of model.modules) {
    const pathKey = `backend/${mod.slug}/overview`;
    const filePath = path.join(archDir, "backend", mod.slug, "overview.md");
    try {
      map.set(pathKey, await fs.readFile(filePath, "utf-8"));
    } catch {
      // overview file may be absent for empty modules
    }
  }

  for (const pkg of model.packages) {
    const pathKey = `frontend/${pkg.slug}/overview`;
    const filePath = path.join(archDir, "frontend", pkg.slug, "overview.md");
    try {
      map.set(pathKey, await fs.readFile(filePath, "utf-8"));
    } catch {
      // overview file may be absent for empty packages
    }
  }

  return map;
}

export async function runStartInit(projectRoot: string): Promise<StartInitReport> {
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

  archLog.info("start-init: cleaning .ai/arch output");
  await cleanArchDir(projectRoot);

  archLog.info("start-init: scanning project");
  const modules = config.scanners.java ? await findMavenModules(projectRoot) : [];
  const { apis: javaApis, rpcs } = config.scanners.java
    ? await scanJavaSources(projectRoot, modules)
    : { apis: [], rpcs: [] };
  const openApis = await scanOpenApiGlobs(projectRoot, config.apiSpecGlobs);
  const packages = config.scanners.frontend ? await scanFrontend(projectRoot) : [];
  const model = mergeDocumentModel(javaApis, openApis, rpcs, modules, packages);

  archLog.info("start-init: scan complete", {
    modules: model.modules.length,
    apis: model.apis.length,
    rpcs: model.rpcs.length,
    packages: model.packages.length,
  });

  archLog.info("start-init: writing markdown and index");
  await writeMarkdownTree(projectRoot, model);
  const index = buildArchIndex(model);
  await writeArchIndex(projectRoot, index);

  const overviewMarkdowns = await readOverviewMarkdowns(projectRoot, model);
  archLog.info("start-init: semantic chunking", {
    overviewDocs: overviewMarkdowns.size,
  });
  const chunks = await buildAllChunks(config, model, overviewMarkdowns);

  archLog.info("start-init: embedding chunks", { chunkCount: chunks.length });
  const embeddings = await embedTexts(
    config,
    chunks.map((c) => c.text)
  );

  archLog.info("start-init: writing vector store");
  const store = new VectorStore(getVectorsDbPath(projectRoot));
  try {
    store.clear();
    store.insert(chunks.map((c, i) => ({ meta: c, embedding: embeddings[i]! })));
  } finally {
    store.close();
  }

  const updatedIndex = await attachChunksToIndex(projectRoot, chunks);
  await writeIndexMd(projectRoot, updatedIndex);

  archLog.info("start-init: done", {
    chunkCount: chunks.length,
    apiCount: model.apis.length,
    moduleCount: model.modules.length,
  });

  return {
    status: "ok",
    chunkCount: chunks.length,
    apiCount: model.apis.length,
    moduleCount: model.modules.length,
  };
}
