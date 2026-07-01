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
export type {
  EntityGraph,
  EntityDef,
  EntityField,
  EntityRelation,
  EntityRelationKind,
  FlowGraph,
  FlowNode,
  FlowEdge,
  FlowLayer,
} from "./types.js";
export type {
  CallGraph,
  CallGraphNode,
  CallGraphNodeKind,
  CallGraphEdge,
  CallGraphEdgeKind,
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

export { scanJpaEntities } from "./scanners/entity-jpa.js";
export { scanMybatisEntities } from "./scanners/entity-mybatis.js";
export { scanSqlEntities } from "./scanners/entity-sql.js";
export { mergeEntityGraphs } from "./scanners/entity-merge.js";
export { deriveFlowGraph } from "./scanners/flow-scanner.js";
export { scanCallGraphJava } from "./scanners/call-graph-java.js";
export { scanCallGraphFrontend } from "./scanners/call-graph-frontend.js";

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

export { writeEntityDocs } from "./writer/entity-md.js";
export { writeFlowDocs } from "./writer/flow-md.js";
export { writeCallGraph } from "./writer/call-graph.js";

export { VectorStore, type SearchHit } from "./vector/sqlite-store.js";

export { buildAssetId } from "./asset/id.js";
export { assetCardToChunkText } from "./asset/chunk-text.js";
export {
  writeModuleAssetDocs,
  upsertAssetCardInModuleDoc,
  upsertAssetSectionInMarkdown,
  removeAssetSectionFromMarkdown,
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

export {
  runReindexApis,
  type ReindexApisReport,
  type ReindexApisDeps,
} from "./reindex/apis.js";

export {
  auditArchChanges,
  MissingLastScanError,
  type AuditArchChangesResult,
  type AuditArchChangesOptions,
  type AuditItem,
} from "./audit/changes.js";

export {
  refreshAssetInArch,
  type RefreshAssetInput,
  type RefreshAssetResult,
  type RefreshAssetDeps,
} from "./refresh/asset.js";

export {
  removeAssetFromArch,
  type RemoveAssetInput,
  type RemoveAssetResult,
} from "./remove/asset.js";

export {
  runSyncChanges,
  type SyncChangesOptions,
  type SyncChangesReport,
} from "./sync/run.js";

export { readLastScan, writeLastScan } from "./incremental/last-scan.js";

export {
  getDesignDir,
  getDesignProfilePath,
  getDesignVectorsDbPath,
  getFrameworkBindingsPath,
  getDesignImplementationsDir,
  getArchAlignmentPath,
  getDesignLogicDir,
} from "./design/paths.js";

export {
  generateFrameworkBindings,
  readFrameworkBindings,
  listSupportedLibraries,
  resolveLibraryTemplate,
  resolveComponentBinding,
  checkFrameworkBindings,
  LIBRARY_TEMPLATES,
} from "./design/bindings.js";

export type {
  DesignPreferences,
  FrameworkBindingEntry,
  FrameworkBindingTarget,
  FrameworkBindingsFile,
  FrameworkBindingsMeta,
  GenerateFrameworkBindingsOptions,
  GenerateFrameworkBindingsReport,
  BindingsCheckReport,
  BindingsCheckWarning,
} from "./design/types.js";

export {
  MissingDesignProfileError,
  DesignComponentNotFoundError,
  DesignPageNotFoundError,
  InvalidDesignIdError,
} from "./design/errors.js";

export {
  queryDesign,
  searchUi,
  appendDesignGap,
  readDesignProfile,
} from "./design/query.js";

export {
  registerUiPattern,
  readUiPattern,
  listUiPatterns,
  getUiPatternFilePath,
} from "./design/implementations.js";

export {
  auditDesignChanges,
  type AuditDesignChangesOptions,
  type AuditDesignChangesResult,
  type AuditDesignStaleItem,
  type AuditDesignMissingBindingItem,
  type AuditDesignPageGapItem,
  type AuditDesignUndeclaredImplementationItem,
  type AuditDesignTokenViolationItem,
} from "./design/audit.js";

export {
  buildDesignArchAlignment,
  buildDesignArchAlignmentReport,
  readArchAlignmentReport,
  type ArchAlignmentReport,
  type ArchAlignmentSuggestion,
  type ArchAlignmentConfidence,
  type BuildDesignArchAlignmentOptions,
} from "./design/alignment.js";

export {
  runDesignSync,
} from "./design/sync.js";

export {
  detectChangedSources,
  detectChangedSourcesForProject,
  classifyAffectedTargets,
  readIngestState,
  runIncrementalDesignSync,
  snapshotSourceFiles,
  writeIngestState,
} from "./design/incremental.js";

export {
  KEYWORD_FALLBACK_THRESHOLD,
  chunkStyleMarkdown,
  collectDesignChunks,
  indexDesignKnowledge,
  reindexDesignIds,
  searchDesignVectors,
} from "./design/vectors.js";

export type {
  DesignSyncOptions,
  DesignSyncReport,
  DesignIngestState,
  ChangedSources,
} from "./design/types.js";

export type {
  DesignProfile,
  DesignComponentCard,
  DesignPageRecipe,
  V0PageManifest,
  V0PageType,
  QueryDesignOptions,
  QueryDesignResult,
  SearchUiOptions,
  SearchUiHit,
  DesignGapRequest,
  DesignIndexResult,
  DesignVectorHit,
  UiPatternImplementation,
  RegisterUiPatternInput,
  RegisterUiPatternResult,
} from "./design/types.js";
