export interface DesignProfile {
  version: 1;
  primarySource: { tool: string; path: string };
  sources: { tool: string; path: string; role?: string }[];
  syncedAt: string;
  sourceMtimeMs?: number;
  componentCount: number;
  pageCount: number;
  warnings: string[];
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
}

export interface DesignSyncReport {
  profile: DesignProfile;
  componentsWritten: number;
  pagesWritten: number;
  tokenFiles: string[];
  warnings: string[];
  dryRun: boolean;
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
  stale: boolean;
}

export interface QueryDesignComponentResult {
  kind: "component";
  component: DesignComponentCard;
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
