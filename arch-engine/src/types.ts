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

export interface FrontendPackage {
  slug: string;
  name: string;
  description: string;
  framework?: string;
  components: { name: string; file: string }[];
  utils: { name: string; file: string }[];
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
}

export interface ArchChunk {
  id: string;
  path: string;
  anchor?: string;
  kind: "api" | "rpc" | "component" | "util" | "overview" | "convention";
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
  };
  apiSpecGlobs: string[];
  scanners: { java: boolean; frontend: boolean };
}
