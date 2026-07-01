# Java API 路径规则补齐 Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-07-04-java-api-path-rules-design.md`
> **Command:** `/plan-from-spec`
> **Status:** approved

**Goal:** 支持 `arch.config` 声明式 Controller 前缀、扩展独立 starter / `WebMvcConfigurer` 自动发现，并提供 `--reindex-apis` 与 MCP 工具，使扫描后可在编辑器内纠正 API 前缀并写回 `api.md`、索引、向量与 `flow.json`。

**Architecture:** 在 `resolveJavaPathRules` 引入 `mergePathRules(auto, manual)` 与 `path-rules.json` 快照；`runReindexApis` 复用 `scanJavaSources` + `mergeDocumentModel`，仅刷新 API 相关 markdown/index/vectors 与可选 flow phase；波次 2 将现有逻辑迁入 `discoverAutoPathRules(roots)` 并扩展探测器；波次 3 在 mcp-server 暴露 `update_java_path_rules` / `query_path_rules`。

---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束

**范围内（spec §1.3，分三波次）：**

| 波次 | 内容 |
|------|------|
| 波次 1（P0） | `ArchConfig.java`、`mergePathRules`、`path-rules.json`、`start-init --reindex-apis`、`pathRulesHash`、`README` |
| 波次 2（P1） | `WebProperties` 直连、`WebMvcConfigurer`、`AutoConfiguration.imports` 链、`extraSourceRoots`、yml-only 补充、fixture |
| 波次 3（P2） | MCP `update_java_path_rules`、`query_path_rules`、AGENTS 工作流、`inject-platform-assets` |

**非目标（spec §1.4）：**

- 反编译 Maven JAR；前端 `baseURL`；`flow.json` HTTP path linker（波次 4）；改变 OpenAPI 优先合并策略。

**无前端 UI** — 设计寻址 N/A。

### 1.2 设计寻址

N/A — arch-engine 扫描器与 MCP 扩展，不涉及 `.ai/design/`。

### 1.3 依赖寻址表

> **寻址说明：** 与 `2026-06-28-frontend-scanning-enhancement-plan.md` 同模式：arch-engine 未自举入 `.ai/arch/`，依赖以 **sourcePath + 行号** 为真源；`query_contract` / `search_arch` 无 TS 命中属预期。

| 依赖 | 来源 | 引用（sourcePath） | 摘要 |
|------|------|---------------------|------|
| `resolveJavaPathRules` | 源码 | `arch-engine/src/scanners/java-path-rules.ts:309` | 全仓 glob `WebMvcRegistrations` → `WebProperties`；**待扩展** config 入参 + manual merge |
| `ControllerPathPrefixRule` / `ResolvedJavaPathRules` | 源码 | `java-path-rules.ts:7-20` | `prefix`、`controllerPattern`、`source`、`confidence` |
| `applyPathRulesToEndpointPath` | 源码 | `java-path-rules.ts:92` | Controller 注解 path + 包名 → 完整 URL |
| `scanJavaSources` | 源码 | `arch-engine/src/scanners/java.ts:58` | 接受可选 `pathRules`；否则内部 `resolveJavaPathRules(projectRoot)`（**需改为传 config**） |
| `mergeDocumentModel` | 源码 | `arch-engine/src/scanners/merge.ts:3` | OpenAPI 优先：`openApis` + java 去重追加 |
| `runStartInit` | 源码 | `arch-engine/src/pipeline.ts:373` | L410-424 path rules + scan；L512/705 `writeMarkdownTree`；增量不重写 api.md（**reindex-apis 补位**） |
| `PipelineOptions` | 源码 | `pipeline.ts:109` | 当前仅 `full?`；**+`reindexApis?`** |
| `cli.ts` | 源码 | `arch-engine/src/cli.ts:28` | `--full`；**+`--reindex-apis`** |
| `ArchConfig` | 源码 | `arch-engine/src/types.ts:290` | **+`java?: JavaScanConfig`** |
| `DEFAULT_CONFIG` | 源码 | `arch-engine/src/config.ts:6` | 模板无 `java` 段（向后兼容） |
| `LastScanState` | 源码 | `arch-engine/src/types.ts:281` | **+`pathRulesHash?: string`** |
| `chunkStructuredEntities` | 源码 | `arch-engine/src/chunking/semantic.ts:96` | 生成 `kind:api` chunks；reindex 仅用 api 子集 |
| `renderApiMd` / `writeMarkdownTree` | 源码 | `markdown.ts:14,249` | 写 `backend/<slug>/api.md` |
| `buildArchIndex` | 源码 | `arch-engine/src/writer/arch-index.ts:49` | API 节点 `anchors` / `keywords` 来自 `model.apis` |
| `VectorStore.deleteByModule` | 源码 | `sqlite-store.ts:314` | 按 path 前缀删 chunk；**或新增 `deleteByKindAndPathPrefix`** 精确删 `kind=api` |
| `deriveFlowGraph` / flow phase | 源码 | `flow-scanner.ts:84`；`registry.ts` flow plugin | reindex 后若 `entities.json` 存在则重跑 |
| `readAutoConfigurationImports` | 源码 | `java-starter.ts:36` | 波次 2 复用 starter 自动配置发现 |
| `java-path-rules.test.ts` | 源码 | `tests/scanners/java-path-rules.test.ts` | 芋道 fixture；非回归基线 |
| mcp-server 工具注册 | 源码 | `mcp-server/src/index.ts` | 波次 3 新增 2 工具（当前 ~18 个） |

### 1.4 拟改动模块与文件

| 文件/模块 | 变更类型 | 波次 | 说明 |
|-----------|----------|------|------|
| `arch-engine/src/types.ts` | 修改 | 1 | `JavaScanConfig`、`ArchConfig.java`、`LastScanState.pathRulesHash`、`PathRulesSnapshot` |
| `arch-engine/src/config.ts` | 修改 | 1 | 校验可选 `java` 段（宽松） |
| `arch-engine/src/scanners/java-path-rules.ts` | 修改 | 1+2 | `mergePathRules`、`writePathRulesSnapshot`；`resolveJavaPathRules(projectRoot, config)`；波次 2 `discoverAutoPathRules` |
| `arch-engine/src/scanners/java.ts` | 修改 | 1 | `scanJavaSources` 传 config 给 rules 解析 |
| `arch-engine/src/pipeline.ts` | 修改 | 1 | `runReindexApis`；`pathRulesHash` warn；导出 |
| `arch-engine/src/cli.ts` | 修改 | 1 | `--reindex-apis` 分支 |
| `arch-engine/src/writer/path-rules.ts` | 新增 | 1 | 写 `.ai/arch/path-rules.json` |
| `arch-engine/src/reindex/apis.ts` | 新增 | 1 | API 专用重算（api.md、index、vectors、flow） |
| `arch-engine/src/vector/sqlite-store.ts` | 修改 | 1 | `deleteApiChunksByModulePrefix` 或等价 |
| `arch-engine/tests/scanners/java-path-rules.test.ts` | 修改 | 1+2 | manual merge、覆盖 auto |
| `arch-engine/tests/reindex/apis.test.ts` | 新增 | 1 | 集成：manual 规则 → reindex → api.md |
| `arch-engine/tests/fixtures/java-path-rules/` | 新增 | 2 | starter-only、configurer-only |
| `arch-engine/src/index.ts` | 修改 | 1+3 | 导出 `runReindexApis`、`updateJavaPathRules` |
| `mcp-server/src/path-rules.ts` | 新增 | 3 | MCP handler |
| `mcp-server/src/index.ts` | 修改 | 3 | 注册 2 工具 |
| `mcp-server/tests/path-rules.test.ts` | 新增 | 3 | |
| `README.md` | 修改 | 1 | manual、`--reindex-apis`、JAR 兜底 FAQ |
| `AGENTS.md` / templates | 修改 | 3 | API 前缀纠正工作流 |
| `scripts/inject-platform-assets.mjs` | 修改 | 3 | 分发 MCP schema |

### 1.5 风险与未决项

| 风险 | 缓解 |
|------|------|
| `resolveJavaPathRules(projectRoot)` 无 config 的调用点遗漏 | `scanJavaSources` 与 pipeline 统一经 `loadOrInitConfig`；`tsc` + 单测 |
| reindex 误删非 API 向量 | 删除条件 `kind='api' AND path LIKE 'backend/<slug>%'` |
| `path-rules.json` 与 `arch.config` 双写不一致 | MCP 只写 config；snapshot 仅由引擎生成 |
| 波次 2 `WebMvcConfigurer` lambda 解析不全 | 文档 warnings + manual 兜底；fixture 覆盖常见 idiom |
| MCP 工具数 +2 与文档「16 工具」表述 | README/演示 deck 波次 3 同步更新计数 |

**无需回填 spec：** 与已批准 spec §14 一致。

---

## Part 2 — 可执行任务清单

> 波次 1 → 2 → 3 **串行**；每波次内 Task 由 **`/implement-plan`** 派发子 Agent 串行执行。子 Agent 每 Task 自动 `git commit`。

---

### 波次 1 — P0 手动规则 + reindex-apis

### Task 1: 类型与配置模型

- [ ] `types.ts` 新增 `JavaScanConfig`、`ControllerPathPrefixConfig`、`PathRulesSnapshot`；`ArchConfig` 加 `java?`；`LastScanState` 加 `pathRulesHash?`
- [ ] `config.ts`：`assertValidConfig` 允许未知顶层键；可选校验 `java.controllerPathPrefixes[].prefix` 以 `/` 开头
  - **MCP:** `query_arch` path=`arch-engine/src/types.ts`（`ArchConfig` 范式 L290）
  - **Files:** `arch-engine/src/types.ts`, `arch-engine/src/config.ts`
  - **Verify:** `cd arch-engine && npm test -- tests/config` 或 `npx tsc --noEmit`

### Task 2: mergePathRules + path-rules 快照

- [ ] `java-path-rules.ts`：抽出 `discoverAutoPathRulesFromRoot(projectRoot)`（暂等于现有 `resolveJavaPathRules` 体）
- [ ] 实现 `mergePathRules(auto, manual)`：同 `controllerPattern` → manual 覆盖，写 `overrides` 审计字段
- [ ] `resolveJavaPathRules(projectRoot, config?)`：合并 manual；返回扩展 `ResolvedJavaPathRules`
- [ ] 新增 `writer/path-rules.ts`：`writePathRulesSnapshot(projectRoot, resolved)`
- [ ] 单测：manual 覆盖 high-confidence auto；仅 manual → `confidence: medium`
  - **MCP:** `query_arch` path=`arch-engine/src/scanners/java-path-rules.ts`
  - **Files:** `arch-engine/src/scanners/java-path-rules.ts`, `arch-engine/src/writer/path-rules.ts`, `arch-engine/tests/scanners/java-path-rules.test.ts`
  - **Verify:** `cd arch-engine && npm test -- tests/scanners/java-path-rules.test.ts`

### Task 3: pipeline 接入 config + pathRulesHash

- [ ] `pipeline.ts`：`runStartInit` 调用 `resolveJavaPathRules(projectRoot, config)`；全量/增量结束后写 `path-rules.json`
- [ ] `buildLastScanState` 写入 `pathRulesHash`（rules JSON stable stringify + hash）
- [ ] 增量模式：若 `pathRulesHash` 相对 `previousScan` 变化 → `archLog.warn` 建议 `--reindex-apis`
- [ ] `java.ts`：`scanJavaSources` 增加 `config?`，传 rules 解析
  - **MCP:** `query_arch` path=`arch-engine/src/pipeline.ts`（L410-424）
  - **Files:** `arch-engine/src/pipeline.ts`, `arch-engine/src/scanners/java.ts`, `arch-engine/src/incremental/last-scan.ts`（若 hash 在 buildLastScanState）
  - **Verify:** `cd arch-engine && npm test -- tests/pipeline`（现有用例非回归）

### Task 4: runReindexApis 核心

- [ ] 新增 `reindex/apis.ts`：`runReindexApis(projectRoot, deps?)`
  - load config → resolve rules → scan APIs → mergeDocumentModel
  - 逐模块 `renderApiMd` 写 `api.md`（可抽 `writeApiDocsOnly` 自 `markdown.ts`）
  - `loadArchIndex` → 更新 API 节点 anchors/keywords → `writeArchIndex` + `writeIndexMd`
  - `VectorStore`：删 `kind=api` 且 path 匹配 `backend/<slug>/api` 的旧 chunk；embed + upsert 新 API chunks
  - 若 `.ai/arch/entities.json` 存在 → 读 entityNames → `deriveFlowGraph` → `writeFlowDocs`
  - 写 `path-rules.json`；更新 `last-scan.pathRulesHash`
- [ ] `sqlite-store.ts`：新增 `deleteChunksWhere(kind, pathPrefix)`（若 `deleteByModule` 过宽）
- [ ] `pipeline.ts` 导出 `runReindexApis`；`index.ts` re-export
  - **MCP:** `query_arch` path=`arch-engine/src/chunking/semantic.ts`（`chunkStructuredEntities` L96）
  - **Files:** `arch-engine/src/reindex/apis.ts`, `arch-engine/src/writer/markdown.ts`, `arch-engine/src/vector/sqlite-store.ts`, `arch-engine/src/pipeline.ts`, `arch-engine/src/index.ts`
  - **Verify:** `cd arch-engine && npm test -- tests/reindex/apis.test.ts`

### Task 5: CLI --reindex-apis

- [ ] `cli.ts`：解析 `--reindex-apis`；与 `--full` 互斥或 `--reindex-apis` 优先并 log
- [ ] 成功输出：`reindex-apis complete: N APIs, M modules updated`
- [ ] 无 `.ai/arch/arch-index.json` 时 exit 2 + 提示先 `start-init`
  - **Files:** `arch-engine/src/cli.ts`, `arch-engine/tests/cli.test.ts`（若无则新增最小用例）
  - **Verify:** `cd arch-engine && npm test && npm run build`

### Task 6: README 与波次 1 狗食验收

- [ ] README § Java Controller URL 前缀：补充 `arch.config.java.controllerPathPrefixes` 示例、`--reindex-apis`、`path-rules.json` 入 git、JAR 依赖兜底
- [ ] FAQ：「改了 manual 规则跑什么」「规则在依赖 JAR」
- [ ] 狗食：java-module fixture + manual `/admin-api` → reindex → api.md 含前缀
  - **Files:** `README.md`, `arch-engine/tests/reindex/apis.test.ts`（补狗食断言）
  - **Verify:** `cd arch-engine && npm test`

**波次 1 验收（spec §11.1 预演，MCP 波次 3 前用手动 config）：** fixture 缺前缀 → 写 `arch.config` manual → `start-init --reindex-apis` → `api.md` 含 `/admin-api`。

---

### 波次 2 — P1 扩展自动发现

### Task 7: discoverAutoPathRules 重构 + WebProperties 直连

- [ ] `java-path-rules.ts`：`discoverAutoPathRules(roots: string[])` 合并多 root glob
- [ ] 探测器 B：任意文件 `@ConfigurationProperties` + `new Api(` → 规则（无需 `WebMvcRegistrations`）
- [ ] `resolveJavaPathRules`：`roots = [projectRoot, ...extraSourceRoots]`
  - **Files:** `arch-engine/src/scanners/java-path-rules.ts`, `arch-engine/tests/scanners/java-path-rules.test.ts`
  - **Verify:** `cd arch-engine && npm test -- tests/scanners/java-path-rules.test.ts`

### Task 8: WebMvcConfigurer 解析

- [ ] 探测器 C：`implements WebMvcConfigurer` + `addPathPrefix` / `pathPrefixes.put` / lambda 含 `controller.admin`
- [ ] 单测：configurer-only fixture（无 `WebMvcRegistrations` 字符串）
  - **Files:** `arch-engine/src/scanners/java-path-rules.ts`, `arch-engine/tests/fixtures/java-path-rules/configurer-only/`, `arch-engine/tests/scanners/java-path-rules.test.ts`
  - **Verify:** `cd arch-engine && npm test -- tests/scanners/java-path-rules.test.ts`

### Task 9: AutoConfiguration 链 + extraSourceRoots

- [ ] 探测器 D：读 `AutoConfiguration.imports` → 加载配置类 → 跑 B/C
- [ ] `arch.config.java.extraSourceRoots` 并入 `discoverAutoPathRules` roots
- [ ] fixture：`framework-starter` 仅 `WebProperties` + `@AutoConfiguration`
  - **MCP:** `query_arch` path=`arch-engine/src/scanners/java-starter.ts`（`readAutoConfigurationImports` L36）
  - **Files:** `arch-engine/src/scanners/java-path-rules.ts`, `arch-engine/tests/fixtures/java-path-rules/starter-only/`
  - **Verify:** `cd arch-engine && npm test -- tests/scanners/java-path-rules.test.ts`

### Task 10: yml-only 补充 + 波次 2 集成

- [ ] 探测器 E：仅 yml 存在 `base.web.*.prefix` + `*.controller` 时生成 `confidence: medium` 规则
- [ ] `start-init --verbose` 日志列出各 rule `source`
- [ ] README 补充独立 starter 自动发现说明
  - **Files:** `arch-engine/src/scanners/java-path-rules.ts`, `README.md`
  - **Verify:** `cd arch-engine && npm test && npm run build`

**波次 2 验收（spec §11.2）：** starter-only fixture → `resolveJavaPathRules` → `/admin-api` + `confidence >= medium`。

---

### 波次 3 — P2 MCP + 工作流

### Task 11: arch-engine updateJavaPathRules API

- [ ] 新增 `path-rules/update.ts`：读/写 `arch.config.json` 的 `java.controllerPathPrefixes`（原子写）；`mode: merge | replace-manual`
- [ ] 可选更新 `extraSourceRoots`；默认 `reindex: true` 调 `runReindexApis`
- [ ] 返回 spec §8.1 JSON 形状（含 samplePaths 前后对比）
- [ ] `index.ts` 导出
  - **Files:** `arch-engine/src/path-rules/update.ts`, `arch-engine/src/index.ts`, `arch-engine/tests/path-rules/update.test.ts`
  - **Verify:** `cd arch-engine && npm test -- tests/path-rules/update.test.ts`

### Task 12: MCP 工具注册与测试

- [ ] `mcp-server/src/path-rules.ts`：`handleUpdateJavaPathRules`、`handleQueryPathRules`
- [ ] `index.ts` 注册 `update_java_path_rules`、`query_path_rules`
- [ ] 单测：mock projectRoot + temp arch.config
  - **Files:** `mcp-server/src/path-rules.ts`, `mcp-server/src/index.ts`, `mcp-server/tests/path-rules.test.ts`
  - **Verify:** `cd mcp-server && npm test -- tests/path-rules.test.ts`

### Task 13: 工作流分发与文档

- [ ] `AGENTS.md` + `templates/feature.md` / `finish-feature.md`：API 前缀纠正 → `update_java_path_rules`；禁止 Controller 循环 `refresh_asset`
- [ ] `apt-verify` SKILL：禁止 `update_java_path_rules`
- [ ] `scripts/inject-platform-assets.mjs`：分发新 MCP 描述
- [ ] README MCP 工具表 +1+1
  - **Files:** `AGENTS.md`, `templates/feature.md`, `.agents/skills/apt-verify/SKILL.md`, `scripts/inject-platform-assets.mjs`, `README.md`
  - **Verify:** `cd mcp-server && npm test && npm run build`；`cd arch-engine && npm run build`

**波次 3 验收（spec §11.1）：** MCP `update_java_path_rules` → `query_arch` 验证 `/admin-api` path；`query_path_rules` 返回 hash 与 rules。

---

## 实现后验收

全波次完成后执行：

```bash
cd arch-engine && npm test && npm run build
cd ../mcp-server && npm test && npm run build
/verify docs/apt/plans/2026-07-04-java-api-path-rules-plan.md
```

**波次 1 可独立 ship**：完成 Task 1–6 即可在业务项目用 manual + `--reindex-apis` 闭环，无需等待 MCP。
