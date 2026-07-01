# v0 页面 Handoff Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-07-02-v0-page-handoff-design.md`
> **Command:** `/plan-from-spec`
> **Status:** approved

**Goal:** 为 v0 页面交付包（`page.manifest.json` + `page.logic.md` + 可选 TSX/HTML）实现 `design-sync --adapter v0`，扩展 `DesignPageRecipe` 与 `query_design(page:)`，使 Agent 能识别页面功能语义并在未批准时 `report_design_gap` 阻塞。

**Architecture:** 在 `arch-engine` 新增 `ingest/v0.ts`（对齐 `html.ts` / `runHtmlDesignSync` 模式），扩展 `types.ts` 与 `paths.ts`（`logic/` 目录）；`sync.ts` 注册 `v0` 适配器并支持批量扫描 `designs/v0/*`；`query.ts` 返回 `logicMarkdown` 与 manifest 相关 `gaps`；`mcp-server` 透传；补充 `designs/v0-fixture/`、`templates/v0-visual-handoff-prompt.md` 与 `/design-page` v0 分支。

---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束

**范围内：**

- PM 目录规范 `designs/v0/<page-id>/` 与 manifest/logic schema
- `design-sync --adapter v0`（单页目录 + 批量 `designs/v0`）
- `DesignPageRecipe` 扩展字段（pageType、feature、route、logicPath、approval 等）
- `query_design(page:)` 返回 logic 全文/截断 + gaps（`manifest-not-approved`、`no-implementation-ref`）
- `search_ui` 索引 pageType/feature 文本
- 夹具 `designs/v0-fixture/user-list/` + 狗食测试
- `/design-page` 增加 v0 视觉伴侣分支（引用 prompt 模板）；**不**新增第 11 个斜杠命令
- README 设计层章节补充 v0 工作流

**非目标（spec §1.3）：**

- v0.dev API / 链接自动拉取
- 实现 Codex 视觉伴侣本身
- 自动把 v0 TSX 盲拷进 `src/`
- 合并 `.ai/design/` 与 `.ai/arch/`
- `/verify` 自动 diff logic 与实现（首期人工/Agent 判断）

### 1.2 设计寻址

| 项 | MCP 结果 | 约束摘要 |
|----|----------|----------|
| 全局 tokens/style/bindings | `query_design(scope: global)` ✅ | `designs/apt-reference-ds`；vue + element-plus bindings；list/form 页实现时优先语义组件 |
| 参考列表页配方 | `query_design(page: list-page)` ✅ | `refPaths: refs/list-page.html`；regions 仅 main；与 `pageType: list` 软对齐 |
| 参考表单页配方 | `query_design(page: form-page)` ✅ | 同上；与 `pageType: form` 软对齐 |
| PageHeader | `query_design(component: PageHeader)` ✅ | 列表/详情页 chrome |
| EmptyState | `query_design(component: EmptyState)` ✅ | 列表空态 |
| v0 页（实现前） | 不存在 | 由 `design-sync --adapter v0` 写入；开发前必须 `query_design(page: <id>)` |

**UI 约束：** v0 fixture 与业务页实现应遵循 global tokens + `style.md`；列表类页参考 `list-page` 区域结构（toolbar + table + empty/loading）。

### 1.3 依赖寻址表

> 本功能为 APT 自举开发；`DesignPageRecipe` 等设计层类型未登记 `register_contract`。`search_arch` 对 `arch-engine/src/design/*` 无命中（索引为 fixture Java）。下列依赖以 **spec + 仓库源码路径** 为 SSOT，实现时直接读文件。

| 依赖 | 来源 | 引用 | 摘要 |
|------|------|------|------|
| `DesignPageRecipe` | 源码 | `arch-engine/src/design/types.ts` | 页面配方；需扩展 pageType/feature/route/logicPath/approval |
| `QueryDesignPageResult` | 源码 | `arch-engine/src/design/types.ts` | 需增 `logicMarkdown?`；gaps 语义扩展 |
| `ingestHtmlSource` / `runHtmlDesignSync` | 源码 | `arch-engine/src/design/ingest/html.ts`、`sync.ts` | HTML 单页 sync 模式；v0 适配器对齐此结构 |
| `queryDesign`（page 分支） | 源码 | `arch-engine/src/design/query.ts` | 现有 gaps 仅检查 component id；需加 manifest/logic/approval |
| `handleQueryDesign` | 源码 | `mcp-server/src/design-query.ts` | MCP 薄封装，随 arch-engine 导出自动透传 |
| `appendDesignGap` / `report_design_gap` | 源码 | `arch-engine/src/design/query.ts`、`mcp-server/src/design-gap.ts` | 阻塞 UI 实现 |
| `indexDesignKnowledge` / `pageToText` | 源码 | `arch-engine/src/design/vectors.ts` | 增量向量需索引 pageType/feature/logic 摘要 |
| `runIncrementalDesignSync` | 源码 | `arch-engine/src/design/incremental.ts` | v0 目录 mtime 纳入增量 |
| `assertDesignId` | 源码 | `arch-engine/src/design/ids.ts` | manifest.id 校验 |
| `html-ingest` 测试模式 | 源码 | `arch-engine/tests/design/html-ingest.test.ts` | v0 单测/集成测模板 |
| `/design-page` 命令 | 模板 | `templates/design-page.md` | 扩展 v0 分支 |
| `list-page` / `form-page` | 设计 MCP | `.ai/design/pages/*.json`（经 query_design） | pageType 对照参考 |

### 1.4 拟改动模块与文件

| 文件/模块 | 变更类型 | 说明 |
|-----------|----------|------|
| `arch-engine/src/design/types.ts` | 修改 | `DesignPageRecipe` 扩展；`DesignSyncOptions.adapter` 增 `v0`；`V0PageManifest` 类型 |
| `arch-engine/src/design/paths.ts` | 修改 | `getDesignLogicDir()` |
| `arch-engine/src/design/ingest/v0.ts` | 新增 | 读 manifest/logic/tsx/html；TSX 启发式；产出 `DesignPageRecipe` |
| `arch-engine/src/design/sync.ts` | 修改 | `runV0DesignSync`；CLI 分支；批量扫描子目录 |
| `arch-engine/src/design/query.ts` | 修改 | 读 logic 文件；gaps：not-approved、no-tsx、missing-logic |
| `arch-engine/src/design/vectors.ts` | 修改 | `pageToText` 含 pageType/feature/description |
| `arch-engine/src/design/incremental.ts` | 修改 | 识别 `designs/v0/**` |
| `arch-engine/src/cli-design-sync.ts` | 修改 | 帮助文案 `--adapter v0` |
| `arch-engine/tests/design/v0-ingest.test.ts` | 新增 | manifest/logic/tsx 解析与 sync |
| `arch-engine/tests/dogfood/v0-handoff.test.ts` | 新增 | fixture → query_design → gaps |
| `designs/v0-fixture/user-list/` | 新增 | 四文件最小夹具 |
| `mcp-server/src/design-query.ts` | 视需要 | 通常无需改（透传 arch-engine） |
| `templates/v0-visual-handoff-prompt.md` | 新增 | Codex 视觉伴侣 prompt |
| `templates/design-page.md` | 修改 | § v0 handoff 分支 |
| `README.md` | 修改 | v0 PM 交付 + design-sync 示例 |
| `docs/superpowers/specs/2026-06-24-*.md` | 可选 | 完成度表补 v0 一行（非阻塞） |

### 1.5 风险与未决项

| 风险 | 缓解 |
|------|------|
| TSX 启发式误判 pageType | 仅 warning，以 manifest 为准 |
| `gaps[]` 与现有 component 缺失共用数组 | 用前缀区分：`manifest-not-approved`、`no-implementation-ref` |
| arch MCP 不索引本仓库 TS 模块 | 狗食测试 + vitest 覆盖；实现 Task 不依赖 `search_arch` 找 design 源码 |
| `logic/` 目录为新路径 | 需在 `paths.ts` 统一；MCP 禁止子 agent 直读 `.ai/design/`（仍经 query_design） |
| 需回填 spec | 无；与 spec 一致 |

---

## Part 2 — 可执行任务清单

> 每步 2–5 分钟粒度；实现时由 `/implement-plan` 按序执行。**主 Agent 串行派发子 Agent**，每 Task 微闭环 + commit。

### Task 1: 类型与路径基础

- [ ] 在 `arch-engine/src/design/types.ts` 定义 `V0PageManifest`、`DesignPageRecipe` 扩展字段、`DesignSyncOptions.adapter` 增加 `"v0"`
  - **Files:** `arch-engine/src/design/types.ts`
- [ ] 在 `arch-engine/src/design/paths.ts` 新增 `getDesignLogicDir(projectRoot)`
  - **Files:** `arch-engine/src/design/paths.ts`
- [ ] 导出类型（若 `arch-engine/src/index.ts` 有 barrel，一并更新）
  - **Files:** `arch-engine/src/index.ts`（如存在导出）
  - **Verify:** `cd arch-engine && npm run build`

### Task 2: `ingest/v0.ts` 核心解析

- [ ] 实现 `readV0Manifest`、`readV0Logic`、manifest 校验（必填字段、pageType 枚举、`assertDesignId`）
  - **MCP:** 对齐 `query_design(page: list-page)` 的 id/title/regions 字段形状
  - **Files:** `arch-engine/src/design/ingest/v0.ts`
- [ ] 实现 `inferPageTypeFromTsx`（Table/DataTable/form 关键词启发式）→ warnings 数组
  - **Files:** `arch-engine/src/design/ingest/v0.ts`
- [ ] 实现 `ingestV0Source(projectRoot, sourceDirRel)` 返回 page recipe + warnings + ref 文件列表
  - **Files:** `arch-engine/src/design/ingest/v0.ts`
  - **Verify:** `cd arch-engine && npm test -- tests/design/v0-ingest.test.ts`（先写测试 RED 再 GREEN）

### Task 3: `v0-ingest` 单元测试

- [ ] 创建 `designs/v0-fixture/user-list/` 最小夹具：`page.manifest.json`、`page.logic.md`、stub `page.tsx`、可选 `preview.html`
  - **Files:** `designs/v0-fixture/user-list/*`
- [ ] `v0-ingest.test.ts`：manifest 缺失 exit/throw；logic 缺失；approved vs draft；tsx 冲突 warning
  - **Files:** `arch-engine/tests/design/v0-ingest.test.ts`
  - **Verify:** `cd arch-engine && npm test -- tests/design/v0-ingest.test.ts`

### Task 4: `design-sync` 注册 v0 适配器

- [ ] 实现 `runV0DesignSync`：写 `pages/<id>.json`、复制 logic 到 `logic/<id>.md`、复制 refs、更新 profile.sources
  - **MCP:** 参照 `ingestHtmlSource` + `runHtmlDesignSync` 写侧模式（实现时读 `arch-engine/src/design/sync.ts`，不调用 MCP 写）
  - **Files:** `arch-engine/src/design/sync.ts`
- [ ] 支持 `--source designs/v0` 批量（一级子目录含 manifest 的均 sync）
- [ ] `cli-design-sync.ts` 帮助与 adapter 校验
  - **Files:** `arch-engine/src/cli-design-sync.ts`
  - **Verify:** `cd arch-engine && npm test -- tests/design/sync.test.ts`；临时目录手动 `design-sync --adapter v0 --dry-run`

### Task 5: `query_design` 与向量扩展

- [ ] `query.ts` page 分支：读 `logicPath` 文件 → `logicMarkdown`（≤8k 截断）；计算 gaps（`manifest-not-approved`、`no-implementation-ref`、缺 logic）
  - **MCP:** 实现后狗食 `query_design(page: user-list)`（Task 7）
  - **Files:** `arch-engine/src/design/query.ts`、`arch-engine/src/design/types.ts`
- [ ] `vectors.ts` `pageToText` 纳入 pageType、feature、description、logic 首段
  - **Files:** `arch-engine/src/design/vectors.ts`
- [ ] `incremental.ts` 跟踪 `designs/v0/**` manifest/logic/tsx mtime
  - **Files:** `arch-engine/src/design/incremental.ts`
  - **Verify:** `cd arch-engine && npm test -- tests/design/query.test.ts tests/design/vectors.test.ts`（补用例）

### Task 6: MCP 与 `report_design_gap` 行为确认

- [ ] 确认 `mcp-server` `query_design` 透传新字段；必要时更新 MCP tool description
  - **Files:** `mcp-server/src/index.ts`（description 字符串）
- [ ] 确认 `templates/feature.md` §0.5 文案：gaps 含 `manifest-not-approved` 时必须 `report_design_gap`（若未覆盖则补一句）
  - **Files:** `templates/feature.md`、经 `inject-platform-assets` 同步的平台副本
  - **Verify:** `cd mcp-server && npm test`

### Task 7: 模板与文档

- [ ] 新增 `templates/v0-visual-handoff-prompt.md`（spec §4.3）
  - **Files:** `templates/v0-visual-handoff-prompt.md`
- [ ] 扩展 `templates/design-page.md`：v0 目录、视觉伴侣、manifest/logic 审阅、`design-sync --adapter v0`
  - **Files:** `templates/design-page.md`
- [ ] README：PM 交付包结构、`design-sync --adapter v0` 示例、与 `/design-page` 关系
  - **Files:** `README.md`
  - **Verify:** `agent-init` 到临时目录确认新模板分发（不含 `_` 前缀规则不变）

### Task 8: 狗食测试与闭环

- [ ] 新增 `arch-engine/tests/dogfood/v0-handoff.test.ts`：fixture sync → `query_design(page: user-list)` 含 pageType/feature/logicMarkdown；draft manifest → gaps 含 `manifest-not-approved`
  - **Files:** `arch-engine/tests/dogfood/v0-handoff.test.ts`
- [ ] 全量：`cd arch-engine && npm test`；`cd mcp-server && npm test`
  - **Verify:** 全绿
- [ ] 主 Agent：`audit_arch_changes`；新/改 design 相关源码 `refresh_asset` 或实现后 sweep；若新增对外类型则 `register_contract`（如 `V0PageManifest` 可选）
  - **MCP:** `audit_arch_changes` → `refresh_asset`（实现阶段主 Agent 执行）

---

**请审阅本 plan 并说「确认」后，使用 `/implement-plan docs/apt/plans/2026-07-02-v0-page-handoff-plan.md` 开始编码。**

确认后将 `Status:` 改为 `approved`。
