# Arch Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 APT 上扩展 `start-init` CLI + `query_arch` / `search_arch` MCP Tools，全自动扫描 Java/OpenAPI/前端 monorepo，语义分片 + OpenAI 兼容 Embedding，生成 `.ai/arch/**` 与 `vectors.db`。

**Architecture:** 新建 `arch-engine/` 包承载扫描、分片、向量、索引；`start-init` CLI 调用 `runStartInit()`；`mcp-server` 依赖 `arch-engine` 暴露只读查询；install 脚本一并构建部署。每次 `start-init` 全量覆盖 arch 产物。

**Tech Stack:** Node.js 18+, TypeScript, Vitest, `@modelcontextprotocol/sdk`, `better-sqlite3`, OpenAI 兼容 REST API, fast-xml-parser（pom 可选）/ 纯 regex+fs 扫描

**Spec:** `docs/superpowers/specs/2026-06-01-arch-bootstrap-design.md`

---

## File Map

| 文件 | 职责 |
|------|------|
| `arch-engine/package.json` | 独立包，CLI + 库导出 |
| `arch-engine/src/types.ts` | DocumentModel、ArchConfig、Chunk 类型 |
| `arch-engine/src/config.ts` | 加载/初始化 `arch.config.json` |
| `arch-engine/src/paths.ts` | `.ai/arch/` 路径解析 |
| `arch-engine/src/scanners/java.ts` | Maven 模块 + Controller/Feign 扫描 |
| `arch-engine/src/scanners/openapi.ts` | OpenAPI 3 + Apifox JSON |
| `arch-engine/src/scanners/frontend.ts` | workspace packages + components/utils 索引 |
| `arch-engine/src/scanners/merge.ts` | OpenAPI 优先合并 |
| `arch-engine/src/writer/markdown.ts` | 渲染 backend/frontend md 树 |
| `arch-engine/src/writer/arch-index.ts` | 生成 `arch-index.json` + `INDEX.md` |
| `arch-engine/src/chunking/semantic.ts` | L1 结构化 + L2/L3 LLM 语义分片 |
| `arch-engine/src/embedding/openai-compatible.ts` | Embedding 批量 + 重试 |
| `arch-engine/src/vector/sqlite-store.ts` | vectors.db CRUD + cosine search |
| `arch-engine/src/pipeline.ts` | `runStartInit(projectRoot)` 主编排 |
| `arch-engine/src/cli.ts` | `start-init` 入口 |
| `arch-engine/tests/fixtures/**` | 合成 monorepo + openapi/apifox json |
| `mcp-server/src/arch-query.ts` | `query_arch` / `search_arch` 实现 |
| `mcp-server/src/index.ts` | 注册新 Tools |
| `bin/start-init.sh` / `.ps1` / `.cmd` | PATH 入口 |
| `scripts/install.sh` / `install.ps1` | 构建 arch-engine + 部署 |
| `templates/start-feature.md` | 增加 search_arch 步骤 |

---

### Task 1: arch-engine 脚手架

**Files:**
- Create: `arch-engine/package.json`
- Create: `arch-engine/tsconfig.json`
- Create: `arch-engine/vitest.config.ts`
- Create: `arch-engine/src/types.ts`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "@apt/arch-engine",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "start-init": "dist/cli.js"
  },
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.0",
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.0.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  },
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 2: tsconfig.json**（与 mcp-server 相同 Node16 设置）

- [ ] **Step 3: types.ts 核心类型**

```typescript
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
  embedding: { baseUrl: string; apiKeyEnv: string; model: string };
  chunking: {
    baseUrl: string;
    apiKeyEnv: string;
    chatModel: string;
    maxChunkTokens: number;
    strategy: "semantic-only";
  };
  apiSpecGlobs: string[];
  scanners: { java: boolean; frontend: boolean };
}
```

- [ ] **Step 4:** `npm install && npm run build`（空 src/index.ts 导出 types 即可通过）

---

### Task 2: config + paths

**Files:**
- Create: `arch-engine/src/config.ts`
- Create: `arch-engine/src/paths.ts`
- Create: `arch-engine/tests/config.test.ts`
- Create: `arch-engine/tests/paths.test.ts`

- [ ] **Step 1: paths.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { getArchDir, getArchConfigPath, getVectorsDbPath } from "../src/paths.js";

describe("arch paths", () => {
  const root = "/project";
  it("getArchDir", () => {
    expect(getArchDir(root)).toMatch(/\.ai[\\/]arch$/);
  });
  it("getVectorsDbPath", () => {
    expect(getVectorsDbPath(root)).toContain("vectors.db");
  });
});
```

- [ ] **Step 2: 实现 paths.ts**

```typescript
import path from "node:path";

export function getArchDir(projectRoot: string): string {
  return path.join(projectRoot, ".ai", "arch");
}
export function getArchConfigPath(projectRoot: string): string {
  return path.join(getArchDir(projectRoot), "arch.config.json");
}
export function getArchIndexPath(projectRoot: string): string {
  return path.join(getArchDir(projectRoot), "arch-index.json");
}
export function getArchIndexMdPath(projectRoot: string): string {
  return path.join(getArchDir(projectRoot), "INDEX.md");
}
export function getVectorsDbPath(projectRoot: string): string {
  return path.join(getArchDir(projectRoot), "vectors.db");
}
```

- [ ] **Step 3: config.test.ts — 缺配置写模板**

- [ ] **Step 4: config.ts**

```typescript
import fs from "node:fs/promises";
import type { ArchConfig } from "./types.js";
import { getArchConfigPath } from "./paths.js";

export const DEFAULT_CONFIG: ArchConfig = {
  embedding: {
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    model: "text-embedding-3-small",
  },
  chunking: {
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    chatModel: "gpt-4o-mini",
    maxChunkTokens: 800,
    strategy: "semantic-only",
  },
  apiSpecGlobs: ["docs/**/*.json", "**/openapi.json", "**/swagger.json"],
  scanners: { java: true, frontend: true },
};

export async function loadOrInitConfig(projectRoot: string): Promise<{ config: ArchConfig; created: boolean }> {
  const p = getArchConfigPath(projectRoot);
  try {
    const raw = await fs.readFile(p, "utf-8");
    return { config: JSON.parse(raw) as ArchConfig, created: false };
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
      return { config: DEFAULT_CONFIG, created: true };
    }
    throw e;
  }
}

export function resolveApiKey(config: ArchConfig, section: "embedding" | "chunking"): string {
  const envName = config[section].apiKeyEnv;
  const key = process.env[envName];
  if (!key) throw new Error(`Missing env ${envName} for ${section}`);
  return key;
}
```

- [ ] **Step 5:** `npm test` PASS

---

### Task 3: OpenAPI / Apifox Scanner

**Files:**
- Create: `arch-engine/src/scanners/openapi.ts`
- Create: `arch-engine/tests/fixtures/openapi/petstore.json`
- Create: `arch-engine/tests/fixtures/apifox/export.json`
- Create: `arch-engine/tests/scanners/openapi.test.ts`

- [ ] **Step 1: petstore.json fixture**（最小 OpenAPI 3 paths）

- [ ] **Step 2: openapi.test.ts 断言解析出 2 个 ApiEndpoint**

- [ ] **Step 3: openapi.ts**

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { ApiEndpoint } from "../types.js";

function slugFromPath(p: string): string {
  return p.replace(/^\/+/, "").replace(/\//g, "-") || "root";
}

export async function parseOpenApiFile(
  filePath: string,
  moduleSlug: string
): Promise<ApiEndpoint[]> {
  const raw = JSON.parse(await fs.readFile(filePath, "utf-8"));
  const doc = raw.openapi ? raw : raw.data?.openapi ? raw.data : raw;
  const paths = doc.paths ?? {};
  const out: ApiEndpoint[] = [];
  for (const [p, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object") continue;
    for (const [method, op] of Object.entries(methods as Record<string, unknown>)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const operation = op as { summary?: string; tags?: string[]; operationId?: string };
      out.push({
        id: `${method.toUpperCase()}-${p}`,
        method: method.toUpperCase(),
        path: p,
        summary: operation.summary ?? operation.operationId ?? p,
        tags: operation.tags ?? [],
        audience: p.includes("/internal") ? "internal" : "frontend-facing",
        source: "openapi",
        moduleSlug,
      });
    }
  }
  return out;
}

export async function scanOpenApiGlobs(
  projectRoot: string,
  globs: string[]
): Promise<ApiEndpoint[]> {
  // 使用 Node fs 递归 + minimatch 或简单 ** 实现；v1 可用 fast-glob 依赖
  // npm install fast-glob
  const fg = await import("fast-glob");
  const files = await fg.glob(globs, { cwd: projectRoot, absolute: true });
  const all: ApiEndpoint[] = [];
  for (const f of files) {
    const moduleSlug = path.basename(path.dirname(f)).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    all.push(...(await parseOpenApiFile(f, moduleSlug)));
  }
  return all;
}
```

- [ ] **Step 4:** 添加 `fast-glob` 依赖，测试 PASS

---

### Task 4: Java Scanner

**Files:**
- Create: `arch-engine/src/scanners/java.ts`
- Create: `arch-engine/tests/fixtures/java-module/pom.xml`
- Create: `arch-engine/tests/fixtures/java-module/src/.../AuthController.java`
- Create: `arch-engine/tests/scanners/java.test.ts`

- [ ] **Step 1: fixture AuthController 含 `@PostMapping("/auth/login")`**

- [ ] **Step 2: java.test.ts 断言 modules + apis**

- [ ] **Step 3: java.ts**

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { ApiEndpoint, JavaModule, RpcEndpoint } from "../types.js";

const MODULE_POM = "**/pom.xml";

export async function findMavenModules(projectRoot: string): Promise<JavaModule[]> {
  const fg = await import("fast-glob");
  const poms = await fg.glob(MODULE_POM, {
    cwd: projectRoot,
    absolute: true,
    ignore: ["**/node_modules/**", "**/target/**"],
  });
  return poms.map((p) => ({
    slug: path.basename(path.dirname(p)).toLowerCase(),
    name: path.basename(path.dirname(p)),
    path: path.relative(projectRoot, path.dirname(p)),
  }));
}

const MAPPING_RE =
  /@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;
const CLASS_MAPPING_RE = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;
const FEIGN_RE = /@FeignClient\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;

export async function scanJavaSources(
  projectRoot: string,
  modules: JavaModule[]
): Promise<{ apis: ApiEndpoint[]; rpcs: RpcEndpoint[] }> {
  const fg = await import("fast-glob");
  const apis: ApiEndpoint[] = [];
  const rpcs: RpcEndpoint[] = [];
  for (const mod of modules) {
    const javaFiles = await fg.glob("**/*.java", {
      cwd: path.join(projectRoot, mod.path),
      absolute: true,
      ignore: ["**/target/**"],
    });
    for (const file of javaFiles) {
      const content = await fs.readFile(file, "utf-8");
      if (content.includes("@FeignClient")) {
        for (const m of content.matchAll(FEIGN_RE)) {
          rpcs.push({
            id: `feign-${m[1]}`,
            name: m[1],
            summary: `Feign client ${m[1]}`,
            moduleSlug: mod.slug,
            source: "java",
          });
        }
      }
      let classBase = "";
      const cm = content.match(CLASS_MAPPING_RE);
      if (cm) classBase = cm[1];
      for (const m of content.matchAll(MAPPING_RE)) {
        const method = m[1].toUpperCase();
        const p = `${classBase}${m[2]}`.replace("//", "/");
        apis.push({
          id: `${method}-${p}`,
          method,
          path: p,
          summary: `${method} ${p}`,
          tags: [],
          audience: p.includes("/internal") ? "internal" : "frontend-facing",
          source: "java",
          moduleSlug: mod.slug,
        });
      }
    }
  }
  return { apis, rpcs };
}
```

- [ ] **Step 4:** 测试 PASS

---

### Task 5: Frontend Scanner + Merge

**Files:**
- Create: `arch-engine/src/scanners/frontend.ts`
- Create: `arch-engine/src/scanners/merge.ts`
- Create: `arch-engine/tests/fixtures/frontend/pnpm-workspace.yaml`
- Create: `arch-engine/tests/scanners/frontend.test.ts`
- Create: `arch-engine/tests/scanners/merge.test.ts`

- [ ] **Step 1: frontend.ts** — 读 root/workspace package.json，列 packages；扫描 `src/components/*.tsx|vue`、`src/utils/*.ts` 文件名

- [ ] **Step 2: merge.ts**

```typescript
import type { ApiEndpoint, DocumentModel } from "../types.js";

export function mergeDocumentModel(
  javaApis: ApiEndpoint[],
  openApis: ApiEndpoint[],
  rpcs: DocumentModel["rpcs"],
  modules: DocumentModel["modules"],
  packages: DocumentModel["packages"]
): DocumentModel {
  const openApiKeys = new Set(openApis.map((a) => `${a.method}:${a.path}`));
  const javaOnly = javaApis.filter((a) => !openApiKeys.has(`${a.method}:${a.path}`));
  return {
    modules,
    apis: [...openApis, ...javaOnly],
    rpcs,
    packages,
  };
}
```

- [ ] **Step 3:** merge 测试：同 path 时 openapi 覆盖 java

---

### Task 6: Markdown Writer + arch-index

**Files:**
- Create: `arch-engine/src/writer/markdown.ts`
- Create: `arch-engine/src/writer/arch-index.ts`
- Create: `arch-engine/tests/writer/markdown.test.ts`

- [ ] **Step 1: markdown.test.ts** — DocumentModel fixture → 断言生成 `backend/foo/api.md` 含 `## POST /auth/login`

- [ ] **Step 2: markdown.ts** — 按 module 写 overview.md / api.md / rpc.md；frontend 写 overview/components/utils

- [ ] **Step 3: arch-index.ts** — 从 DocumentModel 构建 `Record<string, ArchIndexNode>` 树；写 `arch-index.json`

- [ ] **Step 4: renderIndexMd()** — 人类可读 INDEX.md（表格列出模块与 package）

---

### Task 7: 语义分片 SemanticChunker

**Files:**
- Create: `arch-engine/src/chunking/semantic.ts`
- Create: `arch-engine/tests/chunking/semantic.test.ts`

- [ ] **Step 1: L1 测试** — 每个 ApiEndpoint 产生 1 个 ArchChunk，text 含 embedding 前缀格式

```typescript
export function chunkStructuredEntities(model: DocumentModel): ArchChunk[] {
  const chunks: ArchChunk[] = [];
  for (const api of model.apis) {
    chunks.push({
      id: crypto.randomUUID(),
      path: `backend/${api.moduleSlug}/api`,
      anchor: api.id,
      kind: "api",
      title: `${api.method} ${api.path}`,
      text: `[kind:api][module:${api.moduleSlug}][tags:${api.tags.join(",")}][audience:${api.audience}]\n${api.method} ${api.path} — ${api.summary}`,
    });
  }
  // rpc, component, util 同理
  return chunks;
}
```

- [ ] **Step 2: callSemanticSplit()** — 对 overview md 调用 Chat Completions API

```typescript
export async function callSemanticSplit(
  config: ArchConfig,
  markdown: string,
  context: { path: string; kind: string }
): Promise<{ title: string; text: string; keywords: string[] }[]> {
  const apiKey = resolveApiKey(config, "chunking");
  const res = await fetch(`${config.chunking.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.chunking.chatModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Split documentation into semantic chunks. Never cut mid-sentence. Return JSON { chunks: [{ title, text, keywords }] }.",
        },
        { role: "user", content: markdown },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Semantic split failed: ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return JSON.parse(data.choices[0].message.content).chunks;
}
```

- [ ] **Step 3: splitOversized()** — 若 chunk 估计 token > maxChunkTokens，递归 callSemanticSplit

- [ ] **Step 4: semantic.test.ts mock fetch** — 不调用真实 API

---

### Task 8: Embedding Provider

**Files:**
- Create: `arch-engine/src/embedding/openai-compatible.ts`
- Create: `arch-engine/tests/embedding/openai-compatible.test.ts`

- [ ] **Step 1: embedTexts() 批量** — POST `/embeddings`，batch size 64，429 指数退避 3 次

```typescript
export async function embedTexts(
  config: ArchConfig,
  texts: string[]
): Promise<number[][]> {
  const apiKey = resolveApiKey(config, "embedding");
  const res = await fetch(`${config.embedding.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: config.embedding.model, input: texts }),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
  const data = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
```

- [ ] **Step 2: mock test**

---

### Task 9: Vector Store (SQLite)

**Files:**
- Create: `arch-engine/src/vector/sqlite-store.ts`
- Create: `arch-engine/tests/vector/sqlite-store.test.ts`

- [ ] **Step 1: 使用 better-sqlite3 存 chunk 元数据 + embedding BLOB（Float32）**

```typescript
import Database from "better-sqlite3";

export class VectorStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        anchor TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        embedding BLOB NOT NULL
      );
    `);
  }

  clear(): void {
    this.db.exec("DELETE FROM chunks");
  }

  insert(rows: { meta: ArchChunk; embedding: number[] }[]): void {
    const stmt = this.db.prepare(
      "INSERT INTO chunks (id, path, anchor, kind, title, summary, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const tx = this.db.transaction((items) => {
      for (const { meta, embedding } of items) {
        const buf = Buffer.from(new Float32Array(embedding).buffer);
        stmt.run(meta.id, meta.path, meta.anchor ?? null, meta.kind, meta.title, meta.text.slice(0, 500), buf);
      }
    });
    tx(rows);
  }

  search(queryEmbedding: number[], limit: number, kind?: string): SearchHit[] {
    const rows = this.db.prepare("SELECT * FROM chunks").all() as ChunkRow[];
    const scored = rows
      .filter((r) => !kind || r.kind === kind)
      .map((r) => ({
        path: r.path,
        anchor: r.anchor ?? undefined,
        kind: r.kind,
        summary: r.summary,
        score: cosineSimilarity(queryEmbedding, blobToArray(r.embedding)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}
```

> v1 用 brute-force cosine（规格允许中等规模 <5min）；chunk 数量 >5000 时再换 sqlite-vec/HNSW。

- [ ] **Step 2: search 测试** — 插入 3 向量，query 最近邻正确

---

### Task 10: Pipeline + CLI

**Files:**
- Create: `arch-engine/src/pipeline.ts`
- Create: `arch-engine/src/cli.ts`
- Create: `arch-engine/src/index.ts`
- Create: `arch-engine/tests/pipeline.integration.test.ts`

- [ ] **Step 1: cleanArchDir()** — 删除 `.ai/arch/*` 除 `arch.config.json`

- [ ] **Step 2: runStartInit(projectRoot)**

```typescript
export async function runStartInit(projectRoot: string): Promise<StartInitReport> {
  const { config, created } = await loadOrInitConfig(projectRoot);
  if (created) {
    return { status: "config-created" };
  }
  resolveApiKey(config, "embedding"); // throws → exit 1
  await cleanArchDir(projectRoot);
  const modules = config.scanners.java ? await findMavenModules(projectRoot) : [];
  const { apis: javaApis, rpcs } = config.scanners.java
    ? await scanJavaSources(projectRoot, modules)
    : { apis: [], rpcs: [] };
  const openApis = await scanOpenApiGlobs(projectRoot, config.apiSpecGlobs);
  const packages = config.scanners.frontend ? await scanFrontend(projectRoot) : [];
  const model = mergeDocumentModel(javaApis, openApis, rpcs, modules, packages);
  await writeMarkdownTree(projectRoot, model);
  const index = buildArchIndex(model);
  await writeArchIndex(projectRoot, index);
  const l1 = chunkStructuredEntities(model);
  const l2 = await chunkOverviewDocs(projectRoot, config, model);
  const chunks = [...l1, ...l2];
  const embeddings = await embedTexts(config, chunks.map((c) => c.text));
  const store = new VectorStore(getVectorsDbPath(projectRoot));
  store.clear();
  store.insert(chunks.map((c, i) => ({ meta: c, embedding: embeddings[i] })));
  attachChunksToIndex(projectRoot, chunks);
  await writeIndexMd(projectRoot);
  return { status: "ok", chunkCount: chunks.length, apiCount: model.apis.length };
}
```

- [ ] **Step 3: cli.ts**

```typescript
#!/usr/bin/env node
import { runStartInit } from "./pipeline.js";

const root = process.cwd();
const report = await runStartInit(root);
if (report.status === "config-created") {
  console.log("✅ Created arch.config.json — set OPENAI_API_KEY and re-run start-init");
  process.exit(0);
}
console.log(`✅ start-init complete: ${report.apiCount} APIs, ${report.chunkCount} chunks`);
```

- [ ] **Step 4: integration test** — fixture monorepo + mock embedding/split → 断言 vectors.db 存在

---

### Task 11: MCP query_arch + search_arch

**Files:**
- Modify: `mcp-server/package.json` — 添加 `"@apt/arch-engine": "file:../arch-engine"`
- Create: `mcp-server/src/arch-query.ts`
- Modify: `mcp-server/src/index.ts`
- Create: `mcp-server/tests/arch-query.test.ts`

- [ ] **Step 1: arch-query.ts**

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { VectorStore, embedTexts, loadArchIndex, getArchDir } from "@apt/arch-engine";

export async function handleQueryArch(projectRoot: string, archPath?: string, anchor?: string) {
  const index = await loadArchIndex(projectRoot);
  if (!archPath) {
    return index.root;
  }
  const node = index.nodes[archPath];
  if (!node) throw new Error(`Path not found: ${archPath}. Try search_arch.`);
  if (anchor && node.docFile) {
    const md = await fs.readFile(path.join(getArchDir(projectRoot), node.docFile), "utf-8");
    return extractSection(md, anchor);
  }
  return { ...node, children: node.children.map((c) => index.nodes[c]) };
}

export async function handleSearchArch(
  projectRoot: string,
  query: string,
  limit = 5,
  filter?: { kind?: string }
) {
  const config = await loadConfig(projectRoot);
  const [embedding] = await embedTexts(config, [query]);
  const store = new VectorStore(getVectorsDbPath(projectRoot));
  return store.search(embedding, limit, filter?.kind);
}
```

- [ ] **Step 2: index.ts 注册 tools**

```typescript
server.tool("query_arch", "Browse architecture docs by path", { path: z.string().optional() }, ...);
server.tool("search_arch", "Semantic search architecture", { query: z.string(), limit: z.number().optional(), filter: z.object({ kind: z.string().optional() }).optional() }, ...);
```

- [ ] **Step 3: arch-query.test.ts** — 使用 arch-engine fixture 输出目录

---

### Task 12: bin + install + templates

**Files:**
- Create: `bin/start-init.sh`, `bin/start-init.ps1`, `bin/start-init.cmd`
- Modify: `scripts/install.sh`, `scripts/install.ps1`
- Modify: `templates/start-feature.md`
- Modify: `README.md`

- [ ] **Step 1: start-init.ps1**

```powershell
$aptHome = if ($env:APT_HOME) { $env:APT_HOME } else { Join-Path $env:USERPROFILE ".apt" }
node (Join-Path $aptHome "arch-engine/dist/cli.js") @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

- [ ] **Step 2: install.ps1** — 增加 arch-engine build、`npm ci --omit=dev`、复制 dist 到 `~/.apt/arch-engine/`

- [ ] **Step 3: start-feature.md 增加步骤 0**

```markdown
0. **架构发现**：依赖名称不明确时，必须先调用 `search_arch`；锁定 path 后必须 `query_arch` 精读，再查 TS 契约。
```

- [ ] **Step 4: README** — 文档 `agent-init` → `start-init` 顺序、OPENAI_API_KEY、Apifox glob 配置

---

### Task 13: 端到端验收

- [ ] **Step 1:** `cd arch-engine && npm test && npm run build`
- [ ] **Step 2:** `cd mcp-server && npm test && npm run build`
- [ ] **Step 3:** `.\scripts\install.ps1`
- [ ] **Step 4:** 在 `arch-engine/tests/fixtures/demo-monorepo` 运行 `start-init`（设置 mock 或 test key）
- [ ] **Step 5:** Claude Code 中验证 `search_arch` / `query_arch` 可用

---

## Spec Coverage Checklist

| Spec § | Task |
|--------|------|
| start-init 流水线 | Task 10 |
| Java/OpenAPI/Frontend 扫描 | Task 3–5 |
| OpenAPI 优先合并 | Task 5 |
| 语义分片 L1/L2/L3 | Task 7 |
| OpenAI Embedding | Task 8 |
| vectors.db | Task 9 |
| query_arch / search_arch | Task 11 |
| 全量覆盖 | Task 10 cleanArchDir |
| embedding 失败 exit 1 | Task 10 resolveApiKey throw → cli exit 1 |
| install 部署 | Task 12 |
| start-feature 更新 | Task 12 |
| arch.config.json 首次创建 | Task 2 |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-01-arch-bootstrap.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每个 Task 派生子 Agent，Task 间人工/主 Agent 审查
2. **Inline Execution** — 本会话按 Task 顺序直接实现，每 2–3 Task 设检查点

**Which approach?**
