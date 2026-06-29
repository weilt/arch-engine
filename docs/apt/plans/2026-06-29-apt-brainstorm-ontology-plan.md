# APT 2.0.2 Context-Aware Brainstorming via Ontology Query Layer — Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-06-29-apt-brainstorm-ontology-design.md`
> **Command:** `/plan-from-spec`
> **Status:** draft

**Goal:** Ship a context-aware APT-native `/auto-brainstorm` plus a read-only `query_ontology` MCP tool (the 17th) so AI can query the project's real state before designing features.

**Architecture:** `query_ontology` is a pure read-and-fuse layer over existing knowledge (`.ai/arch`, `.ai/db.json`, `.ai/design`, `.apt/`, `arch.config.json`) — no new data layer. It reuses `aggregateStatus()` (status), `handleSearchArch()` (topic assets), `readDb()` (contracts), and `classifySpecRisk()` (approval). The `/auto-brainstorm` template is rewritten into a fully self-contained 9-step APT-native brainstorming engine (no superpowers dependency) with ontology awareness, risk grading, and adaptive interaction.

---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束

**范围内（v2.0.2 成品）：**
- `query_ontology` MCP 工具（第 17 个）：无参 → 项目快照；带 topic → 焦点检索。
- `/auto-brainstorm` 升级为 APT 原生头脑风暴引擎（完整 9 步，去除 Visual Companion）+ ontology 感知 + 风险分级 + 自适应交互。
- `projectMeta` 手动声明配置（`arch.config.json`）。

**非目标（排除）：**
- 数据实体/关系/流程层（表、FK、join）→ v2.0.3
- `relations` 字段（v2.0.2 省略，v2.0.3 带版本号引入）
- Visual Companion（浏览器可视化）→ 不在路线图
- 向量库结构/embedding 流变更 → 不动
- arch-index 回填 utils/enums/pojo 节点 → 已知缺口（§3.3），本版用 markdown `##` 计数绕过，不修
- superpowers:brainstorming 依赖 → 不依赖（五平台行为一致）
- writing-plans skill → 不调用，终端是 `/plan-from-spec`

### 1.2 设计寻址

N/A — spec §1.3 明确排除前端 UI。本功能无 UI 实现，无设计寻址需求。

### 1.3 依赖寻址表

> **基线说明（重要）：** 本功能修改的是 APT 工具自身源码（`mcp-server/src/*`、`arch-engine/src/*`）。`query_contract` / `search_arch` 查询的是 `.ai/` 索引中**被扫描项目**（Java fixture 应用）的知识，而非工具自身源码。因此工具自身 TS 源不在 `.ai/` 索引中是**既定基线**（与 v2.0.1 frontend-scanning 计划一致）。对工具自身源码依赖，以**源码路径 + 行号**为实证依据（直接读源码比 `.ai/` 索引对实现文件更权威、更新），不调用 `report_missing`（这些依赖存在于源码，仅未被自索引，并非缺失）。

| 依赖 | 来源 | 引用（tsFilePath / sourcePath / path） | 摘要 / 关键签名 |
|------|------|----------------------------------------|------|
| `aggregateStatus` | 源码 | `mcp-server/src/status/aggregate.ts`（export，`async (projectRoot, opts?) => ProjectStatus`） | 复用于快照 status。内部已捕获 `MissingLastScanError` → phase=blocked、db 缺失 → blocked；对外不抛错。**只读复用 `aggregateStatus`（非 `handleQueryProjectStatus`，避免 write-back 抖动）。** |
| `ProjectStatus` 类型 | contract | `mcp-server/src/status/types.ts`（已注册于 `.ai/db.json`） | `query_contract("ProjectStatus")` 命中。字段：phase / loopDone / nextAction / goal / activeSpec / activePlan / specRisk / specApproval / tasks{total,done,blocked} / lastVerify / blockers / summary。 |
| `classifySpecRisk` | 源码 | `mcp-server/src/status/risk.ts`（`({frontmatter?, text, changedFilesEstimate?}) => "low"|"high"`） | 复用于 approvalState.specRisk + auto-brainstorm 步骤 6.5。规则：frontmatter.risk=high → high；正文含 HIGH_RISK_KEYWORDS → high；>8 文件 → high；否则 low。 |
| `handleSearchArch` | 源码 | `mcp-server/src/arch-query.ts`（`async (projectRoot, query, limit?, filter?) => SearchHit[]`） | 复用于 topic 焦点 assets。返回 `SearchHit { path kind title summary score }`（`@apt/arch-engine` 导出 `type SearchHit`）。 |
| `readDb` / `findContract` | 源码 | `mcp-server/src/db.ts`（`readDb(projectRoot)`） | db.json → `{ contracts[], missingRequests[] }`；`contracts[i] = { name description tsFilePath registeredAt }`。复用于快照 contracts 列表 + topic 契约子串匹配。 |
| `getArchDir` / `loadArchIndex` / `loadOrInitConfig` / `VectorStore` / `SearchHit` | `@apt/arch-engine` | `arch-engine/src/index.ts`（barrel）；`paths.ts` / `config.ts` / `vector/sqlite-store.ts` | `getArchDir(root)`→`.ai/arch/`；`loadOrInitConfig(root)`→`{config, created}`（config.projectMeta 为本版新增）；`SearchHit` 类型复用于 topic assets 形状。 |
| `ArchConfig` | 源码（待改） | `arch-engine/src/types.ts`（`interface ArchConfig`，已有 v2.0.1 `frontendPackages?`） | 本版新增 `projectMeta?: ProjectMeta | null`。 |
| `DEFAULT_CONFIG` | 源码（待改） | `arch-engine/src/config.ts`（`export const DEFAULT_CONFIG`） | 本版新增 `projectMeta: null`。 |
| `risk.ts HIGH_RISK_KEYWORDS` | 源码 | `mcp-server/src/status/risk.ts`（`readonly string[]`） | auto-brainstorm 风险触发规则与之一致（已在 risk.ts 落地）。 |
| `inject-platform-assets.cjs` | 源码 | `scripts/inject-platform-assets.cjs`（`PUBLIC_TEMPLATES` Set） | `auto-brainstorm.md` **已在** `PUBLIC_TEMPLATES` 中 → 无需改分发列表（是改写非新增）。 |
| `_agents-md-snippet.md` | 源码 | `templates/_agents-md-snippet.md` | 已有 `/auto-brainstorm` 行（描述可微调，无结构变化）。 |

**MCP 实证（本计划阶段执行）：** `query_contract("ProjectStatus")` 命中（db.json 第 1 契约）；`query_contract("ArchConfig")` 未命中（工具自身 TS 未自索引，符合基线，非缺失）；`search_arch` 仅返回 Java fixture 命中（arch-engine TS 不在向量库，符合基线）。工具自身依赖均以源码实证为准。

### 1.4 拟改动模块与文件

| 文件/模块 | 变更类型 | 说明 |
|-----------|----------|------|
| `mcp-server/src/ontology/types.ts` | 新增 | ProjectOntology / OntologyTopicResult / ProjectMeta / ModuleOntology / PackageOntology 等纯类型 |
| `mcp-server/src/ontology/asset-counter.ts` | 新增 | 读 `.ai/arch/{backend|frontend}/{slug}/*.md` 数 `##` 标题，filename→kind 映射 |
| `mcp-server/src/ontology-query.ts` | 新增 | `handleQueryOntology(projectRoot, topic?)`：快照 + 焦点双模式，容错（恒 200） |
| `mcp-server/src/index.ts` | 编辑 | 注册 `query_ontology` 为第 17 个 `server.tool` |
| `mcp-server/tests/ontology-query.test.ts` | 新增 | 快照/焦点/容错/未初始化 单测 |
| `arch-engine/src/types.ts` | 编辑 | `ArchConfig` 增 `projectMeta?: ProjectMeta | null` |
| `arch-engine/src/config.ts` | 编辑 | `DEFAULT_CONFIG.projectMeta = null` |
| `arch-engine/tests/config.test.ts` | 编辑 | 增 projectMeta 默认值断言 |
| `templates/auto-brainstorm.md` | 改写 | APT 原生 9 步头脑风暴引擎（去 Visual Companion + ontology 感知 + 风险分级 + 自适应） |
| `.agents/skills/apt-auto-brainstorm/SKILL.md` | 新增 | 与模板同内容、Codex skill frontmatter（与现有 apt-plan-from-spec 等一致模式） |
| `templates/_agents-md-snippet.md` | 编辑 | `/auto-brainstorm` 描述补 ontology 感知 |
| `README.md` | 编辑 | `/auto-brainstorm` 行描述更新（命令数仍 10） |

**注意（构建顺序）：** `mcp-server` 经 `file:../arch-engine` 依赖 `@apt/arch-engine`，解析到 `arch-engine/dist`。故 Task 2 改 `arch-engine` 类型后**必须 `tsc` 构建 dist**，Task 3/4（mcp-server）才能看到新 `projectMeta` 类型通过类型检查。

### 1.5 风险与未决项

- **[HIGH] 风险分级**：本功能自身命中 mcp-server / arch-engine 关键词 + 新对外契约（ProjectOntology 等）+ >8 文件。`/auto-brainstorm` 产出的本类 spec 会被判 high、停等人批（符合设计）。
- **已知缺口（不修）**：`arch-index.json` 节点树缺 utils/enums/pojo 节点。`query_ontology` 用 markdown `##` 计数绕过（已实证：auth-starter/utils.md=1 `## AuthTokenHelper`、base-common/pojo.md=2、base-common/enums.md=1）。
- **module/package 名称来源**：`name` 取 arch-index 节点 title（若存在，已实证 `backend/auth-starter`→title="auth-starter"），否则回退目录名（slug）。overview.md 首行 `# <slug>` 不可靠（部分仅 slug）。
- **progress 派生**：快照 `progress.{doneCount,totalCount}` 派生自 `aggregateStatus().tasks`（已解析 progress.md），`currentTask` 轻量再读 progress.md 取首个未完成行（不重复解析，避免双重维护 `parseProgress`）。
- **design 检测**：本仓库 `.ai/design/` 有 tokens+pages+components 但**无 profile.json、无 framework-bindings.json**。检测逻辑 = tokens/ 目录有 `.json` **或** profile.json 存在 → 设计层存在（本仓库 tokens 存在 → 存在）；`hasBindings`=framework-bindings.json 存在（本仓库 false）。
- **status 映射**：快照 `status` 字段为 `{ phase loopDone nextAction activeGoal? }`；`activeGoal = aggregateStatus().goal`。

---

## Part 2 — 可执行任务清单

> 每步 2–5 分钟粒度；由 `/implement-plan` 按 Task 派发子 Agent 串行执行（每 Task 全新上下文 + Task Review Gate）。子 Agent 每 Task 自动 `git commit`。
> **构建/验证命令约定**（无根 package.json，按包执行）：tsc 类型检查 = `node node_modules/typescript/bin/tsc --noEmit`（在对应包目录）；测试 = `npx vitest run <path>`（在对应包目录）。

### Task 1: Ontology 类型定义
- [ ] 新建 `mcp-server/src/ontology/types.ts`，定义纯类型：
  - `ProjectMeta { name?: string; techStack?: string[] }`
  - `OntologyAssetCount`（动态键：api/rpc/util/enum/pojo/starter/component/apiClient/route/store，均 `?` number）
  - `ModuleOntology { slug: string; name: string; assetCounts: OntologyAssetCount }`
  - `PackageOntology { slug: string; name: string; framework?: string; assetCounts: OntologyAssetCount }`
  - `OntologyContract { name: string; tsFile: string }`
  - `OntologyDesign { hasTokens: boolean; hasBindings: boolean; pages: string[]; components: string[] }`
  - `OntologyApprovalState { specRisk?: SpecRisk; state?: ApprovalState }`（复用 `status/types.ts` 的 SpecRisk/ApprovalState）
  - `OntologyProgress { currentTask?: string; doneCount: number; totalCount: number }`
  - `ProjectOntology`（spec §3.2 快照全部字段，project/status/progress?/modules/packages/contracts/design?/approvalState?）
  - `OntologyTopicResult { topic: string; matchedIn: string[]; assets: SearchHit[]; contracts: OntologyContract[]; designPages?: string[] }`（复用 `SearchHit` from `@apt/arch-engine`）
  - **MCP:** `query_contract` name=`ProjectStatus`（确认 SpecRisk/ApprovalState 形状）
  - **Files:** `mcp-server/src/ontology/types.ts`
- [ ] 类型检查通过
  - **Verify:** 在 `mcp-server/` 执行 `node node_modules/typescript/bin/tsc --noEmit`

### Task 2: projectMeta 配置（arch-engine）
- [ ] 在 `arch-engine/src/types.ts` 的 `interface ArchConfig` 增 `projectMeta?: { name?: string; techStack?: string[] } | null`（与 v2.0.1 `frontendPackages?` 同位置同风格）
  - **MCP:** 源码实证 `arch-engine/src/types.ts`（`ArchConfig` 定义处）
  - **Files:** `arch-engine/src/types.ts`
- [ ] 在 `arch-engine/src/config.ts` 的 `DEFAULT_CONFIG` 增 `projectMeta: null`
  - **Files:** `arch-engine/src/config.ts`
- [ ] 扩展 `arch-engine/tests/config.test.ts`：断言 `DEFAULT_CONFIG.projectMeta` 为 `null`（与现有 `loadOrInitConfig creates file when missing` 断言同 harness）
  - **Files:** `arch-engine/tests/config.test.ts`
- [ ] 类型检查 + 构建 dist + 测试
  - **Verify:** 在 `arch-engine/` 执行 `node node_modules/typescript/bin/tsc --noEmit` 然后 `node node_modules/typescript/bin/tsc`（构建 dist，mcp-server 依赖）；`npx vitest run tests/config.test.ts`
  - **Contracts:** `ProjectMeta` 类型来源（arch-engine 不导出该类型，mcp-server 自有定义）

### Task 3: Asset 计数器（mcp-server）
- [ ] 新建 `mcp-server/src/ontology/asset-counter.ts`：
  - `listArchModules(projectRoot): Promise<ModuleOntology[]>` — 枚举 `.ai/arch/backend/{slug}/` 子目录，对每个目录列 `.md`（排除 `overview.md`），数 `^## ` 行，filename→kind 映射；`name` 取 arch-index 节点 title（`loadArchIndex`）否则 slug
  - `listArchPackages(projectRoot): Promise<PackageOntology[]>` — 枚举 `.ai/arch/frontend/{slug}/`，同法；`framework?` 暂不填（v2.0.3 实体层补）
  - filename→kind 映射常量（spec §3.3）：`api.md=api`、`rpc.md=rpc`、`utils.md=util`、`enums.md=enum`、`pojo.md=pojo`、`starter.md=starter`、`components.md=component`、`api-clients.md=apiClient`、`routes.md=route`、`stores.md=store`（未识别文件跳过）
  - 复用 `getArchDir`、`loadArchIndex` from `@apt/arch-engine`
  - **MCP:** 源码实证 `.ai/arch/backend/auth-starter/utils.md`（1 个 `## AuthTokenHelper`）
  - **Files:** `mcp-server/src/ontology/asset-counter.ts`, `mcp-server/src/ontology/types.ts`
- [ ] 新建 `mcp-server/tests/asset-counter.test.ts`：用 tmpdir 写 fixture（`backend/foo/utils.md` 含 2 个 `##`、`backend/foo/enums.md` 含 1 个、`overview.md` 被排除），断言 `listArchModules` 返回 `foo` 的 assetCounts
  - **Files:** `mcp-server/tests/asset-counter.test.ts`
- [ ] 类型检查 + 测试
  - **Verify:** 在 `mcp-server/` 执行 `node node_modules/typescript/bin/tsc --noEmit`（需 Task 2 已构建 arch-engine dist）；`npx vitest run tests/asset-counter.test.ts`

### Task 4: query_ontology 处理器（mcp-server）
- [ ] 新建 `mcp-server/src/ontology-query.ts`，导出 `handleQueryOntology(projectRoot, topic?: string): Promise<ProjectOntology | OntologyTopicResult | { error: string }>`：
  - **入口守卫**：`arch-index.json` 不存在 → 返回 `{ error: "project not initialized; run start-init first" }`（唯一硬错误，其余恒 200）
  - **快照模式（topic 缺省）**：`project`（`loadOrInitConfig`→`config.projectMeta`，created→project=null）；`status`（`aggregateStatus(projectRoot)`→`{phase loopDone nextAction activeGoal: goal}`）；`progress?`（从 status.tasks 派生 doneCount/totalCount，轻量读 progress.md 取 currentTask，缺失则字段缺省）；`modules`/`packages`（Task 3）；`contracts`（`readDb`→`contracts.map(c=>({name:c.name,tsFile:c.tsFilePath}))`）；`design?`（tokens 目录有 `.json` 或 profile.json 存在 → 检测，列 pages/components 文件名去扩展名）；`approvalState?`（读 `.apt/approvals.json` + `classifySpecRisk`）
  - **焦点模式（topic 存在）**：`assets`（`handleSearchArch(projectRoot, topic, 10)`，捕获异常→空数组）；`contracts`（db.json，topic 小写子串匹配 `name` 小写 contains）；`designPages?`（设计层存在时，pages slug 子串匹配）；`matchedIn`（透明聚合哪些层命中）
  - **容错**：每个子读取 try/catch，失败字段缺省；handler 整体永不抛错给 MCP 调用方
  - 复用：`aggregateStatus`（status/aggregate.ts）、`handleSearchArch`（arch-query.ts）、`readDb`（db.ts）、`classifySpecRisk`（risk.ts）、`getArchDir`/`loadArchIndex`/`loadOrInitConfig`（@apt/arch-engine）
  - **MCP:** 源码实证 `mcp-server/src/status/aggregate.ts`（aggregateStatus 签名）、`mcp-server/src/arch-query.ts`（handleSearchArch 签名）、`mcp-server/src/db.ts`（readDb）
  - **Files:** `mcp-server/src/ontology-query.ts`, `mcp-server/src/ontology/asset-counter.ts`, `mcp-server/src/ontology/types.ts`
- [ ] 新建 `mcp-server/tests/ontology-query.test.ts`：tmpdir fixture（最小 `.ai/arch/backend/foo/utils.md` + `.ai/db.json` + `.ai/arch/arch-index.json`），断言：① 无参返回含 modules/contracts/status 的快照；② `handleQueryOntology(root, "auth")` 返回 focus 结构（matchedIn/contracts 子串匹配）；③ 无 arch-index.json → `{error:...}`；④ 缺 db.json → contracts 空数组不崩。stub `aggregateStatus`（注入 opts）与 `handleSearchArch`（mock 或最小 vectors 不依赖远程 embedding）
  - **Files:** `mcp-server/tests/ontology-query.test.ts`
- [ ] 类型检查 + 测试
  - **Verify:** 在 `mcp-server/` 执行 `node node_modules/typescript/bin/tsc --noEmit`；`npx vitest run tests/ontology-query.test.ts`

### Task 5: MCP 工具注册（mcp-server）
- [ ] 在 `mcp-server/src/index.ts` 顶部 import `handleQueryOntology`（from `./ontology-query.js`）
  - **MCP:** 源码实证 `mcp-server/src/index.ts`（现有 16 个 `server.tool` 注册 + handleQueryProjectStatus import 行）
  - **Files:** `mcp-server/src/index.ts`
- [ ] 新增第 17 个 `server.tool("query_ontology", <描述>, { topic: z.string().optional() }, async ({topic}) => {...})`，描述强调无参=项目快照、带 topic=焦点检索、只读，handler 套 `JSON.stringify(result,null,2)`，错误兜底 `isError:true`
  - **Files:** `mcp-server/src/index.ts`
- [ ] 类型检查 + mcp-server 全量测试
  - **Verify:** 在 `mcp-server/` 执行 `node node_modules/typescript/bin/tsc --noEmit`；`npx vitest run`

### Task 6: /auto-brainstorm 模板 + Codex skill（改写）
- [ ] 改写 `templates/auto-brainstorm.md` 为 APT 原生 9 步引擎（spec §3.6）：① 探索项目上下文（AI 可自主调 `query_ontology()`）；② 去除（无 Visual Companion）；③ 逐条澄清提问（AI 可随时 `query_ontology(topic)`）；④ 提 2-3 方案权衡+推荐；⑤ 分节确认设计（ontology 软提示：标注检测到的既有资产/契约）；⑥ 写 spec 到 `docs/superpowers/specs/`，含新章节「Ontology detection」；⑥.5 风险分级（对齐 risk.ts）；⑦ spec 自检（占位/一致性/范围/歧义）；⑧ 用户审 spec（仅 high）；⑨ 终端自动接 `/plan-from-spec`（low）/ 停等人批（high）。加自适应交互模式说明（人在→交互；`.apt/goal.md` 存在且 apt-goal 循环→全自动 AI 兼扮两角）。**不引用 superpowers**（grep 校验无 `superpowers` 依赖）
  - **MCP:** 源码实证 `templates/auto-brainstorm.md`（当前 ~30 行风险分级壳）、`mcp-server/src/status/risk.ts`（风险规则一致）
  - **Files:** `templates/auto-brainstorm.md`
- [ ] 新建 `.agents/skills/apt-auto-brainstorm/SKILL.md`，frontmatter 为 `name: apt-auto-brainstorm` + `description: ...`，body 与模板**同内容**（与现有 `.agents/skills/apt-plan-from-spec/SKILL.md` 同模板同源一致模式）
  - **MCP:** 源码实证 `.agents/skills/apt-plan-from-spec/SKILL.md`（与 templates/plan-from-spec.md 同内容仅 frontmatter 异）
  - **Files:** `.agents/skills/apt-auto-brainstorm/SKILL.md`
- [ ] 校验
  - **Verify:** `Select-String -Path templates/auto-brainstorm.md,.agents/skills/apt-auto-brainstorm/SKILL.md -Pattern superpowers` 应无命中（确认无外部 skill 依赖）

### Task 7: 文档与 snippet 微调
- [ ] 更新 `templates/_agents-md-snippet.md` 的 `/auto-brainstorm` 行描述，补「ontology 感知」与「APT 原生」（仅描述，无结构变化）
  - **MCP:** 源码实证 `templates/_agents-md-snippet.md`（已有该行）
  - **Files:** `templates/_agents-md-snippet.md`
- [ ] 更新 `README.md` 的 `/auto-brainstorm` 行描述同步（命令数仍 10）
  - **MCP:** 源码实证 `README.md`（`/auto-brainstorm` 行：当前 AI brainstorming 生成 spec 并风险分级）
  - **Files:** `README.md`
- [ ] 校验
  - **Verify:** `Select-String -Path README.md -Pattern /auto-brainstorm` 命中 1 行且含 ontology/原生 描述

### Task 8: 全量构建 + 测试 + 契约注册（验收前置）
- [ ] 全量类型检查两个包
  - **Verify:** `arch-engine/` 执行 `node node_modules/typescript/bin/tsc --noEmit`；`mcp-server/` 执行 `node node_modules/typescript/bin/tsc --noEmit`
- [ ] 全量测试两个包（既有 + 新增全绿）
  - **Verify:** `arch-engine/` 执行 `npx vitest run`；`mcp-server/` 执行 `npx vitest run`
- [ ] 注册新对外契约（3 个新公开 TS 类型）
  - **Contracts:** `register_contract` name=`ProjectOntology` tsFilePath=`mcp-server/src/ontology/types.ts`；`OntologyTopicResult` 同文件；`ProjectMeta` 同文件
- [ ] 更新 spec 自检：若实现与 spec 有偏差（如 status 字段映射、progress 派生），回填 spec §3.2/3.4

---

**请审阅本 plan 文件并说「确认」后，使用 `/implement-plan docs/apt/plans/2026-06-29-apt-brainstorm-ontology-plan.md` 开始编码；实现完成后使用 `/verify docs/apt/plans/2026-06-29-apt-brainstorm-ontology-plan.md` 验收。**
