export interface DesignPreferences {
  productType?: string;
  framework?: "react" | "vue";
  uiLibrary?: string;
  styleNotes?: string;
}

export interface DesignProfile {
  version: 1;
  primarySource: { tool: string; path: string };
  sources: { tool: string; path: string; role?: string }[];
  syncedAt: string;
  sourceMtimeMs?: number;
  componentCount: number;
  pageCount: number;
  warnings: string[];
  preferences?: DesignPreferences;
}

export interface FrameworkBindingTarget {
  import: string;
  component: string;
  props?: Record<string, unknown>;
  notes?: string;
}

export interface FrameworkBindingEntry {
  react?: FrameworkBindingTarget;
  vue?: FrameworkBindingTarget;
}

export interface FrameworkBindingsMeta {
  framework: "react" | "vue";
  library: string;
  generatedAt?: string;
  productType?: string;
  styleNotes?: string;
}

export type FrameworkBindingsFile = {
  _meta: FrameworkBindingsMeta;
} & Record<string, FrameworkBindingEntry | FrameworkBindingsMeta>;

export interface GenerateFrameworkBindingsOptions {
  framework: "react" | "vue";
  library: string;
  productType?: string;
  styleNotes?: string;
  dryRun?: boolean;
}

export interface GenerateFrameworkBindingsReport {
  path: string;
  framework: "react" | "vue";
  library: string;
  componentMappings: number;
  dryRun: boolean;
}

export interface BindingsCheckWarning {
  code: "missing_bindings" | "orphan_bindings" | "no_bindings_file" | "ui_library_not_set";
  message: string;
  ids?: string[];
}

export interface BindingsCheckReport {
  ok: boolean;
  warnings: BindingsCheckWarning[];
  uiLibrary?: string;
  framework?: string;
}

export interface DesignComponentCard {
  id: string;
  role?: string;
  anatomy?: string[];
  states?: string[];
  tokenRefs?: string[];
  constraints?: string[];
  refPaths?: string[];
  promptExcerpt?: string;
  sourcePath?: string;
}

export interface DesignPageRecipe {
  id: string;
  title: string;
  regions: { id: string; components: string[] }[];
  states?: Record<string, string>;
  refPaths?: string[];
}

export interface DesignSyncOptions {
  source?: string;
  dryRun?: boolean;
  pagesOnly?: boolean;
  incremental?: boolean;
}

export interface DesignIngestState {
  version: 1;
  sourceRel: string;
  syncedAt: string;
  files: Record<string, number>;
}

export interface ChangedSources {
  added: string[];
  modified: string[];
  deleted: string[];
  all: string[];
}

export interface DesignSyncReport {
  profile: DesignProfile;
  componentsWritten: number;
  pagesWritten: number;
  tokenFiles: string[];
  warnings: string[];
  dryRun: boolean;
  incremental?: boolean;
  changedFiles?: string[];
  reindexedIds?: string[];
}

export interface QueryDesignOptions {
  scope?: "global";
  page?: string;
  component?: string;
}

export interface QueryDesignGlobalResult {
  kind: "global";
  profile: DesignProfile;
  style: string;
  tokens: Record<string, Record<string, string>>;
  bindings: FrameworkBindingsFile | null;
  stale: boolean;
}

export interface QueryDesignComponentResult {
  kind: "component";
  component: DesignComponentCard;
  binding: FrameworkBindingEntry | null;
  stale: boolean;
}

export interface QueryDesignPageResult {
  kind: "page";
  page: DesignPageRecipe;
  gaps: string[];
  stale: boolean;
}

export type QueryDesignResult =
  | QueryDesignGlobalResult
  | QueryDesignComponentResult
  | QueryDesignPageResult;

export interface SearchUiOptions {
  query: string;
  limit?: number;
  filter?: { kind?: "component" | "page" };
}

export interface SearchUiHit {
  kind: "component" | "page";
  id: string;
  title: string;
  score: number;
  snippet?: string;
}

export interface DesignGapRequest {
  need: string;
  page?: string;
  reason: string;
  reportedAt: string;
}

export interface DesignIndexResult {
  indexed: number;
  skipped: boolean;
  warning?: string;
}

export interface DesignVectorHit {
  kind: "component" | "page";
  id: string;
  title: string;
  score: number;
  snippet?: string;
}

export interface UiPatternImplementation {
  page: string;
  sourcePath: string;
  componentsUsed: string[];
  notes?: string;
  registeredAt: string;
}

export interface RegisterUiPatternInput {
  page: string;
  sourcePath: string;
  componentsUsed: string[];
  notes?: string;
}

export interface RegisterUiPatternResult {
  ok: true;
  page: string;
  path: string;
  record: UiPatternImplementation;
}
