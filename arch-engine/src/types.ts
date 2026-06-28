export type ArchNodeKind = "root" | "module" | "api-doc" | "component-doc" | "package";

export interface ApiEndpoint {
  id: string;
  method: string;
  path: string;
  summary: string;
  tags: string[];
  audience: "frontend-facing" | "internal";
  source: "openapi" | "java";
  parameters?: string;
  moduleSlug: string;
}

export interface RpcEndpoint {
  id: string;
  name: string;
  summary: string;
  moduleSlug: string;
  source: "java";
}

export interface FrontendSymbol {
  name: string;
  file: string;
  description: string;
  exports: string[];
}

export interface FrontendEnum {
  name: string;
  file: string;
  description: string;
  members: string[];
}

export interface FrontendPackage {
  slug: string;
  name: string;
  description: string;
  framework?: string;
  components: FrontendSymbol[];
  utils: FrontendSymbol[];
  enums: FrontendEnum[];
  apiClients?: ApiClientContract[];
  routes?: RouteEntry[];
  stores?: StoreContract[];
}

export interface ApiClientContract {
  name: string;
  file: string;
  description: string;
  endpoints: { method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; path: string }[];
}

export interface RouteEntry {
  path: string;
  name?: string;
  component?: string;
  meta?: Record<string, unknown>;
  children?: RouteEntry[];
}

export interface StoreContract {
  name: string;
  storeId?: string;
  file: string;
  description: string;
  state: string[];
  getters: string[];
  actions: string[];
}

export interface JavaModule {
  slug: string;
  name: string;
  path: string;
}

export interface DocumentModel {
  modules: JavaModule[];
  apis: ApiEndpoint[];
  rpcs: RpcEndpoint[];
  packages: FrontendPackage[];
  /** Backend AssetCards written to utils/enums/pojo md (optional, SA-1+). */
  assetCards?: AssetCard[];
}

export type AssetKind =
  | "api"
  | "rpc"
  | "component"
  | "util"
  | "enum"
  | "starter"
  | "pojo"
  | "contract"
  | "api-client"
  | "route"
  | "store";

export interface AssetCard {
  id: string;
  kind: AssetKind;
  name: string;
  module: string;
  path: string;
  summary: string;
  whenToUse: string;
  howToUse: string;
  exports: string[];
  related: string[];
  tags: string[];
  source: "scan" | "register" | "refresh";
  updatedAt: string;
}

export interface RawCandidate {
  kind: AssetKind;
  name: string;
  moduleSlug: string;
  filePath: string;
  javadoc: string;
  signatures: string[];
  extra?: Record<string, string>;
}

export interface ArchChunk {
  id: string;
  path: string;
  anchor?: string;
  kind:
    | "api"
    | "rpc"
    | "component"
    | "util"
    | "enum"
    | "overview"
    | "convention"
    | "starter"
    | "pojo"
    | "api-client"
    | "route"
    | "store";
  title: string;
  text: string;
}

export interface ArchIndexNode {
  path: string;
  kind: ArchNodeKind;
  title: string;
  summary: string;
  children: string[];
  docFile?: string;
  chunks: string[];
  keywords: string[];
  anchors?: string[];
}

export interface LastScanModuleEntry {
  sourcePath: string;
  assetCount: number;
  fileHashes: Record<string, string>;
}

export interface LastScanState {
  version: 2;
  commit: string;
  branch: string;
  scannedAt: string;
  modules: Record<string, LastScanModuleEntry>;
  packages: Record<string, LastScanModuleEntry>;
}

export interface ArchConfig {
  embedding: {
    baseUrl: string;
    /** Env var name when apiKey is not set inline. */
    apiKeyEnv: string;
    /** Inline key (optional). Prefer arch.secrets.json for local-only secrets. */
    apiKey?: string;
    model: string;
    /** Max texts per /embeddings request. DashScope caps at 10. */
    batchSize?: number;
  };
  chunking: {
    baseUrl: string;
    apiKeyEnv: string;
    apiKey?: string;
    chatModel: string;
    maxChunkTokens: number;
    strategy: "semantic-only";
    /** Candidates per summarize LLM request (default 8). Lower if MaaS returns 500/EOF. */
    summarizeBatchSize?: number;
    /** Retries on 429/5xx for summarize (default 3, same as semantic split). */
    summarizeMaxRetries?: number;
    /** Base delay ms before first summarize retry (default 1000, doubles each attempt). */
    summarizeRetryBaseDelayMs?: number;
    /** Max public signatures per candidate in summarize prompt (default 12). */
    maxSignaturesPerCandidate?: number;
    /** Max output tokens for summarize completion (default 4096). */
    summarizeMaxTokens?: number;
    /** Pause ms between summarize batches within one module (default 300). */
    summarizeBatchDelayMs?: number;
    /**
     * Use OpenAI json_object response_format for summarize.
     * Default: false when chatModel name contains "code" (e.g. astron-code-latest).
     */
    summarizeJsonMode?: boolean;
  };
  apiSpecGlobs: string[];
 /** Optional glob patterns for design-system / UI base packages (e.g. "@star/ui"). */
 designSystemPackages?: string[];
  /** Optional glob patterns for frontend app packages not at the JS repo root (e.g. "web", "admin-ui"). */
  frontendPackages?: string[];
 scanners: { java: boolean; frontend: boolean };
}
