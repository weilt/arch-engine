export type {
  ArchNodeKind,
  ApiEndpoint,
  RpcEndpoint,
  FrontendPackage,
  JavaModule,
  DocumentModel,
  ArchChunk,
  ArchIndexNode,
  ArchConfig,
} from "./types.js";

export {
  getArchDir,
  getArchConfigPath,
  getArchIndexPath,
  getArchIndexMdPath,
  getVectorsDbPath,
} from "./paths.js";

export {
  DEFAULT_CONFIG,
  loadOrInitConfig,
  resolveApiKey,
} from "./config.js";

export { parseOpenApiFile, scanOpenApiGlobs } from "./scanners/openapi.js";

export { findMavenModules, scanJavaSources } from "./scanners/java.js";

export { scanFrontend } from "./scanners/frontend.js";

export { mergeDocumentModel } from "./scanners/merge.js";

export {
  writeMarkdownTree,
  buildArchIndex,
  readArchIndex,
  loadArchIndex,
  writeArchIndex,
  renderIndexMd,
  writeIndexMd,
  type ArchIndex,
} from "./writer/index.js";

export { VectorStore, type SearchHit } from "./vector/sqlite-store.js";

export { buildAssetId } from "./asset/id.js";
export { assetCardToChunkText } from "./asset/chunk-text.js";
export {
  writeModuleAssetDocs,
  upsertAssetCardInModuleDoc,
  upsertAssetSectionInMarkdown,
} from "./writer/asset-md.js";

export {
  registerAssetInArch,
  inferAssetScope,
  patchArchIndexForAsset,
  type RegisterAssetInput,
  type RegisterAssetResult,
} from "./register-asset.js";

export {
  chunkStructuredEntities,
  callSemanticSplit,
  splitOversizedChunks,
  buildAllChunks,
  estimateTokens,
  type SemanticSplitChunk,
} from "./chunking/semantic.js";

export { embedTexts, embedQuery } from "./embedding/openai-compatible.js";

export {
  cleanArchDir,
  runModuleBatch,
  runStartInit,
  type ModuleBatchResult,
  type PipelineDeps,
  type PipelineOptions,
  type StartInitReport,
} from "./pipeline.js";
