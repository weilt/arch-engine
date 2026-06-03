# Arch AI 驱动扫描 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. **主 Agent 只负责编排**；每个 Subagent Mission 由**全新子 Agent** 实现，完成后主 Agent 验收再派下一个，防止上下文爆炸。

**Goal:** 将 Arch Bootstrap 升级为 v2：Discovery → AI AssetCard → markdown + 向量 upsert；支持 git 增量与 `register_asset` 开发闭环；chongqing `base-common` 可搜到 Utils/Enum/RPC。

**Architecture:** 在 `arch-engine/` 新增 `AssetCard` 模型、Java/TS discovery v2、AI summarize 批处理、VectorStore upsert、增量 `last-scan.json`；`mcp-server` 新增 `register_asset`；pipeline 改为按 module 分批写入。

**Tech Stack:** Node.js 18+, TypeScript, Vitest, better-sqlite3, OpenAI 兼容 REST（embedding + chat）

**Spec:** `docs/superpowers/specs/2026-06-02-arch-ai-scan-design.md`

---

## 主 Agent 编排规则（必读）

### 子 Agent 分工

| Mission | 名称 | 独占目录/文件 | 前置依赖 | 验收门槛 |
|---------|------|---------------|----------|----------|
| **SA-1** | 类型 + Java Discovery + Backend MD | `types.ts`, `scanners/java*.ts`, `writer/markdown.ts`, fixtures | 无 | 测试通过；fixture 产出 utils/enums/rpc/pojo md |
| **SA-2** | TS Discovery v2 + Frontend MD | `scanners/frontend.ts`, `scanners/ts-export.ts`, `writer/*` | SA-1 合并 | 测试通过；export 图发现 component |
| **SA-3** | AI Summarize + AssetCard Pipeline | `summarize/*`, `asset/*`, `pipeline.ts` | SA-1, SA-2 | mock LLM 测试；chunks 含 whenToUse |
| **SA-4** | Vector Upsert + 增量 last-scan | `vector/*`, `incremental/*`, `cli.ts` | SA-3 | upsert/delete 测试；`--full`/`--incremental` |
| **SA-5** | MCP register_asset + 模板 | `mcp-server/*`, `templates/finish-feature.md`, README | SA-4 | register 后 search 命中 |

### 执行顺序（严格串行）

```
主 Agent
  → 派 SA-1 子 Agent（fresh context）
  → 验收：cd arch-engine && npm test
  → 派 SA-2 子 Agent
  → 验收：npm test
  → 派 SA-3 … SA-5
  → 最终 code-reviewer 子 Agent
```

**禁止：** 并行派两个实现子 Agent（会改同一文件冲突）。

**每个子 Agent 必须收到：**
1. 本 Mission 全文（从下文复制，不要让它自己读 plan）
2. Spec 第 4–7 节 + 本 Mission 相关节
3. 上一 Mission 的 handoff 摘要（主 Agent 写 5 行以内）
4. 仓库路径：`f:\software\claude_plugin`
5. 命令：`cd arch-engine && npm test` 必须通过

**子 Agent 不得：** 实现其他 Mission 范围；改 unrelated 文件；跳过测试。

---

## File Map（v2 新增/大改）

| 文件 | 职责 | Mission |
|------|------|---------|
| `arch-engine/src/types.ts` | `AssetCard`, `RawCandidate`, `LastScanState` | SA-1 |
| `arch-engine/src/asset/id.ts` | 稳定 id 生成 `backend/{module}/{kind}/{name}` | SA-1 |
| `arch-engine/src/asset/chunk-text.ts` | AssetCard → embedding 文本 | SA-1 |
| `arch-engine/src/scanners/java.ts` | Feign name=、Utils、enum、DTO 发现 | SA-1 |
| `arch-engine/src/scanners/java-feign.ts` | Feign 接口方法签名提取（从 java.ts 拆出） | SA-1 |
| `arch-engine/src/writer/markdown.ts` | backend utils/enums/pojo/constants md | SA-1 |
| `arch-engine/src/writer/asset-md.ts` | AssetCard 渲染为 `## name` + 字段表 | SA-1 |
| `arch-engine/tests/fixtures/java/base-common/**` | 最小 Java 夹具 | SA-1 |
| `arch-engine/tests/scanners/java-v2.test.ts` | Discovery 单测 | SA-1 |
| `arch-engine/src/scanners/ts-export.ts` | export 图、PascalCase 组件候选 | SA-2 |
| `arch-engine/src/scanners/frontend.ts` | 递归 src/**，接 ts-export | SA-2 |
| `arch-engine/src/summarize/prompt.ts` | AssetCard JSON prompt | SA-3 |
| `arch-engine/src/summarize/batch.ts` | 每批 20 候选调 LLM | SA-3 |
| `arch-engine/src/summarize/fallback-card.ts` | 失败占位 Card | SA-3 |
| `arch-engine/src/pipeline.ts` | 按 module 分批 orchestration | SA-3, SA-4 |
| `arch-engine/src/vector/sqlite-store.ts` | upsertChunks, deleteByIds, deleteByModule | SA-4 |
| `arch-engine/src/incremental/last-scan.ts` | 读写 last-scan.json | SA-4 |
| `arch-engine/src/incremental/git-diff.ts` | commit diff → affected modules | SA-4 |
| `arch-engine/src/cli.ts` | `--full` flag | SA-4 |
| `mcp-server/src/register-asset.ts` | register_asset 实现 | SA-5 |
| `mcp-server/src/arch-query.ts` | search 返回 assetId, sourcePath | SA-5 |
| `mcp-server/src/index.ts` | 注册 tool | SA-5 |
| `templates/finish-feature.md` | 双轨注册说明 | SA-5 |

---

# Subagent Mission SA-1: 类型 + Java Discovery + Backend Markdown

**Handoff 给下一 Mission：** `RawCandidate[]` 从 Java 模块产出；`writeBackendAssetMarkdown(module, cards)` 可写 utils/enums/pojo/rpc md。

## Task SA-1.1: AssetCard 类型与 id 工具

**Files:**
- Modify: `arch-engine/src/types.ts`
- Create: `arch-engine/src/asset/id.ts`
- Create: `arch-engine/src/asset/chunk-text.ts`
- Create: `arch-engine/tests/asset/id.test.ts`
- Create: `arch-engine/tests/asset/chunk-text.test.ts`

- [ ] **Step 1: 写失败测试 id.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { buildAssetId } from "../../src/asset/id.js";

describe("buildAssetId", () => {
  it("builds backend util id", () => {
    expect(buildAssetId("backend", "base-common", "util", "JsonUtils")).toBe(
      "backend/base-common/util/JsonUtils"
    );
  });
});
```

- [ ] **Step 2: 运行测试确认 FAIL**

Run: `cd arch-engine && npm test -- tests/asset/id.test.ts`  
Expected: FAIL module not found

- [ ] **Step 3: 实现 types.ts 扩展**

在 `types.ts` 增加：

```typescript
export type AssetKind =
  | "api"
  | "rpc"
  | "component"
  | "util"
  | "enum"
  | "starter"
  | "pojo"
  | "contract";

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
  source: "scan" | "register";
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
```

扩展 `ArchChunk.kind` 增加 `"starter" | "pojo"`。

- [ ] **Step 4: 实现 id.ts + chunk-text.ts**

`buildAssetId(scope, module, kind, name)` → `{scope}/{module}/{kind}/{name}`

`assetCardToChunkText(card: AssetCard): string` 按 spec §4 模板拼接。

- [ ] **Step 5: 运行测试 PASS**

Run: `cd arch-engine && npm test -- tests/asset/`

---

## Task SA-1.2: Java Feign 修复 + 方法签名

**Files:**
- Create: `arch-engine/src/scanners/java-feign.ts`
- Modify: `arch-engine/src/scanners/java.ts`
- Create: `arch-engine/tests/scanners/java-feign.test.ts`

- [ ] **Step 1: 写失败测试** — 输入含 `@FeignClient(name = RpcConstants.SYSTEM_NAME)` 的 `DictDataCommonApi.java` 片段，期望解析出 interface 名 + `@GetMapping` 方法。

- [ ] **Step 2: 实现 parseFeignInterface(content): { name, clientRef, methods[] }`**
  - 支持 `name=` 和 `value=`
  - clientRef 为常量时保留原始文本，name 字段用 interface 简单名

- [ ] **Step 3: 修改 scanJavaSources** — RPC 条目 `name` 用 interface 名（如 `DictDataCommonApi`），`summary` 含第一个 `@Operation(summary=)` 若有。

- [ ] **Step 4: 测试 PASS**

---

## Task SA-1.3: Java Utils / Enum / POJO / Constants 发现

**Files:**
- Create: `arch-engine/src/scanners/java-assets.ts`
- Modify: `arch-engine/src/scanners/java.ts`（导出 `discoverJavaCandidates`）
- Create: `arch-engine/tests/fixtures/java/base-common/src/main/java/...`（CommonStatusEnum, JsonUtils, DictDataCommonApi 精简版）
- Create: `arch-engine/tests/scanners/java-assets.test.ts`

- [ ] **Step 1: 写失败测试** — fixture 模块应发现 ≥1 enum、≥1 util、≥1 pojo、≥1 feign

- [ ] **Step 2: 实现 discoverJavaCandidates(projectRoot, module): RawCandidate[]`**
  - `public enum` → kind enum
  - `class *Utils` 或 `*Helper` → kind util
  - `*DTO|*Req|*Resp|*Param|*Result` 或包路径含 `pojo` → kind pojo
  - `*Constants` → kind util（tags: constants）

- [ ] **Step 3: 提取 public 方法签名**（正则即可）+ 类 Javadoc 首段

- [ ] **Step 4: 测试 PASS**

---

## Task SA-1.4: Backend Asset Markdown Writer

**Files:**
- Create: `arch-engine/src/writer/asset-md.ts`
- Modify: `arch-engine/src/writer/markdown.ts`
- Modify: `arch-engine/src/writer/arch-index.ts`
- Create: `arch-engine/tests/writer/asset-md.test.ts`

- [ ] **Step 1: 写失败测试** — 输入 2 张 AssetCard，输出含 `## JsonUtils` 与字段表

- [ ] **Step 2: 实现 renderAssetCard(card)` 与 `writeModuleAssetDocs(projectRoot, moduleSlug, cards)`**
  - 写入 `backend/{slug}/utils.md` 等按 kind 分文件
  - anchor = 小写 name 或 slugify

- [ ] **Step 3: arch-index 节点增加 enums/utils/pojo 子节点**

- [ ] **Step 4: 测试 PASS + 全量 `npm test`**

---

### SA-1 验收清单（主 Agent）

- [ ] `cd arch-engine && npm test` 全部通过
- [ ] fixture 运行后存在 `utils.md`、`enums.md` 且非空
- [ ] Feign `name=` 不再漏扫
- [ ] **不修改** pipeline.ts 主流程（留给 SA-3）

### SA-1 Handoff 摘要模板

```
SA-1 done. Added AssetCard/RawCandidate, discoverJavaCandidates(), backend asset md writer.
Feign name= fixed. Tests: N passing. pipeline.ts unchanged.
```

---

# Subagent Mission SA-2: TS Discovery v2 + Frontend Markdown

**前置：** SA-1 已合并。  
**Handoff：** `discoverFrontendCandidates(pkg)` 产出 RawCandidate；不再绑死 `src/components/**`。

## Task SA-2.1: export 图扫描

**Files:**
- Create: `arch-engine/src/scanners/ts-export.ts`
- Create: `arch-engine/tests/scanners/ts-export.test.ts`

- [ ] **Step 1: 失败测试** — `Button.tsx` export default function + props → kind component

- [ ] **Step 2: 实现 `discoverExports(fileContent, filePath): { name, kindHint }[]`**
  - PascalCase + `.tsx/.vue` → component 候选
  - `export enum` → enum
  - `*Utils` 或 named function exports → util

- [ ] **Step 3: PASS**

---

## Task SA-2.2: frontend.ts 递归 + 候选

**Files:**
- Modify: `arch-engine/src/scanners/frontend.ts`
- Modify: `arch-engine/tests/scanners/frontend.test.ts`

- [ ] **Step 1: 改为 `src/**/*.{ts,tsx,vue}` glob**（仍 ignore node_modules/dist）

- [ ] **Step 2: 每文件调 ts-export + ts-doc，合并为 RawCandidate[]**

- [ ] **Step 3: 保留现有 FrontendPackage 结构，components/utils/enums 填 RawCandidate 兼容字段**

- [ ] **Step 4: PASS + 全量 npm test**

---

### SA-2 验收清单

- [ ] 不破坏 SA-1 测试
- [ ] frontend fixture 仍 PASS
- [ ] 新增 export 图测试 PASS

---

# Subagent Mission SA-3: AI Summarize + Pipeline 分批

**前置：** SA-1, SA-2 已合并。

## Task SA-3.1: Summarize 模块（可 mock）

**Files:**
- Create: `arch-engine/src/summarize/prompt.ts`
- Create: `arch-engine/src/summarize/batch.ts`
- Create: `arch-engine/src/summarize/fallback-card.ts`
- Create: `arch-engine/tests/summarize/batch.test.ts`

- [ ] **Step 1: prompt 要求严格 JSON AssetCard，中文 summary**

- [ ] **Step 2: batch.ts `summarizeCandidates(config, candidates, batchSize=20): Promise<AssetCard[]>`**
  - 注入 `summarizeFn` 便于测试 mock
  - 失败 retry 1 次 → fallback-card

- [ ] **Step 3: mock 测试：2 candidates → 2 AssetCards，字段齐全**

---

## Task SA-3.2: Pipeline 按 module 分批

**Files:**
- Modify: `arch-engine/src/pipeline.ts`
- Create: `arch-engine/tests/pipeline-batch.test.ts`

- [ ] **Step 1: 新增 `runModuleBatch(projectRoot, config, module, candidates)`**
  - summarize → writeModuleAssetDocs → buildChunksFromAssetCards → embed → vector insert（暂可用 clear+insert，SA-4 改 upsert）

- [ ] **Step 2: runStartInit 改为 loop modules/packages**（mock summarize 测 orchestration）

- [ ] **Step 3: 无 API key 时仍 exit 1**（保留 assertValidConfig）

- [ ] **Step 4: PASS**

---

### SA-3 验收清单

- [ ] pipeline 不再一次性 clean 后只写 api/overview
- [ ] mock LLM 测试不调用真实 API
- [ ] AssetCard chunk 文本含 whenToUse

---

# Subagent Mission SA-4: Vector Upsert + Git 增量

**前置：** SA-3 已合并。

## Task SA-4.1: VectorStore upsert API

**Files:**
- Modify: `arch-engine/src/vector/sqlite-store.ts`
- Create: `arch-engine/tests/vector/sqlite-store.test.ts`

- [ ] **Step 1: 实现 upsertChunks（INSERT OR REPLACE）**

- [ ] **Step 2: deleteByIds(ids), deleteByModule(modulePrefix)** — path LIKE `backend/base-common/%`

- [ ] **Step 3: 测试 upsert 覆盖同 id、delete 后 search 为空

---

## Task SA-4.2: last-scan + git diff

**Files:**
- Create: `arch-engine/src/incremental/last-scan.ts`
- Create: `arch-engine/src/incremental/git-diff.ts`
- Create: `arch-engine/tests/incremental/git-diff.test.ts`
- Modify: `arch-engine/src/cli.ts`

- [ ] **Step 1: read/write last-scan.json（spec §8.2 schema）**

- [ ] **Step 2: getChangedFilesSince(commit) 用 `git diff --name-only`**

- [ ] **Step 3: mapFilesToModules(changed, modules) → Set<slug>**

- [ ] **Step 4: cli `--full` 跳增量；默认有 last-scan 则增量**

- [ ] **Step 5: pipeline 增量只跑 affected modules + upsert**

- [ ] **Step 6: 成功完成后写 last-scan；embedding 失败不更新 last-scan

---

### SA-4 验收清单

- [ ] 增量测试用 mock git 或 fixture commit
- [ ] `--full` 行为与 v1 类似但用 upsert 按 module

---

# Subagent Mission SA-5: MCP register_asset + 文档闭环

**前置：** SA-4 已合并。

## Task SA-5.1: register_asset MCP

**Files:**
- Create: `mcp-server/src/register-asset.ts`
- Modify: `mcp-server/src/index.ts`
- Modify: `mcp-server/src/arch-query.ts`
- Create: `mcp-server/tests/register-asset.test.ts`（若已有 test 目录）

- [ ] **Step 1: 实现 registerAsset(projectRoot, input)**
  - 校验 sourcePath
  - buildAssetId
  - upsert markdown（复用 arch-engine 导出函数，mcp-server 依赖 arch-engine）
  - embed + vector upsert
  - 更新 arch-index

- [ ] **Step 2: search_arch 结果加 assetId, sourcePath；filter.kind 加 starter, pojo

- [ ] **Step 3: mcp-server build + test

---

## Task SA-5.2: finish-feature + README

**Files:**
- Modify: `templates/finish-feature.md`
- Modify: `README.md`

- [ ] **Step 1: finish-feature 双轨说明 + register_asset 示例**

- [ ] **Step 2: README 增加 v2 流程、last-scan、--full

---

### SA-5 验收清单（v2「能用」门槛）

- [ ] `register_asset` 后 `search_arch` 可命中（集成测试或手动步骤写进 README）
- [ ] P4 完成定义满足 spec §14

---

# Subagent Mission SA-6: Starter A+B ✅

**范围:** `*-starter` Maven 模块 + UI 基础包；spec §5.1/§5.2 Starter 行。  
**状态:** 已完成（子 Agent SA-6，92 tests passing）。

**交付:** `java-starter.ts`、`frontend-starter.ts`、`designSystemPackages` 配置、pipeline 合并 starter candidates。

---

## Spec Coverage Self-Review

| Spec § | Mission |
|--------|---------|
| §4 AssetCard | SA-1 |
| §5 Discovery | SA-1, SA-2, SA-6 |
| §6 AI Summarize | SA-3 |
| §7 写入 + upsert | SA-1, SA-3, SA-4 |
| §8 增量 | SA-4 |
| §9 register_asset | SA-5 |
| §10 finish-feature | SA-5 |
| §11 search 扩展 | SA-5 |
| §13 测试 | 各 Mission |

---

## 主 Agent 派单子 Agent 模板

复制以下内容作为 Task tool 的 prompt（每次替换 `{MISSION}` 为 SA-1…SA-5 对应章节全文）：

```
你在 f:\software\claude_plugin 实现 Arch AI Scan v2 的 {MISSION_ID}。

规则：
- 只实现本 Mission 范围，不碰其他 Mission 文件
- TDD：先写失败测试再实现
- 完成后运行 cd arch-engine && npm test（SA-5 还需 cd mcp-server && npm test）
- 不要 git commit（除非用户要求）
- 用中文写 handoff 摘要（5 行以内）

{MISSION_FULL_TEXT}

Handoff from previous:
{PREVIOUS_HANDOFF}
```

---

**Plan complete.** 执行方式：**Subagent-Driven（推荐）** — 主 Agent 按 SA-1 → SA-5 顺序派子 Agent，每 Mission 验收后再派下一个。
