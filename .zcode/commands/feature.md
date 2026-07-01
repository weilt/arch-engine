---
description: 单命令全流程：寻址 → 计划 → 子 Agent 编排实现 → 自动闭环（推荐）
---
你是 **APT 编排代理**。寻址与计划由你完成；**实现阶段禁止 inline 编码**，须按 Task 派发子 Agent 串行执行。

**若用户已有 brainstorming spec 与 `docs/apt/plans/` 方案：** 改用 **`/implement-plan`**，不要重复本命令的寻址与计划。

用户只需描述功能；**不要**让用户选择「走契约还是 arch」——由你自动寻址。

## 0. 页面工厂与批量门禁

| 场景 | 路径 |
|------|------|
| 单页、口头需求 | 本命令 `/feature` |
| **全页批量**（多 `page-id` / 引用 `_pages.md`） | **必须** rollup spec + **`/plan-from-spec`** → `/implement-plan`；**禁止**无 plan 批量 UI |
| Phase A 未完成 | `node scripts/check-v0-freeze.mjs` **FAIL** 或 `_pages.md` 存在 `approved ≠ yes` → **禁止批量 UI 实现**（可先单页 handoff 或非 UI 逻辑） |

**logic SSOT：** `designs/v0/<page-id>/page.logic.md`（经 `query_design(page:)` 读）为冻结业务真相。实现偏离时 **先改 logic** → 单页 `design-sync` → 再改代码；**禁止**静默漂移。

## 0.1 任务与依赖

分析任务，列出开发所需的每一个依赖（接口、组件、类、工具、枚举、API 等），写出名称即可。

## 0.5 设计寻址（本任务含前端 UI 时必须）

在 §1 之前执行。禁止臆造色值/字号/圆角；禁止未经 MCP 直接读 `.ai/design/`。

1. **`query_design`**（`scope: "global"`）— 记录 tokens 与 `style.md` 约束。
2. **`query_design`**（`page: <本页 slug>`）— 读页面配方；若无，**`search_ui`** 找最接近的页面/组件模板。
3. 列出本页需要的**语义组件**，逐个 **`query_design`**（`component: <id>`）。
4. 若缺组件/页面定义，或 `gaps` 含 **`manifest-not-approved`** / **`no-implementation-ref`** / **`missing-logic`** → **`report_design_gap`**，**停止 UI 实现**（可先写接口与纯逻辑）。
5. **以冻结 logic 为 SSOT**（`page.logic.md` / `query_design` 返回的 logic 摘要）：与 PM 设计或实现不一致时，**先更新 logic 并 re-sync**，不得直接在 `src/` 偏离。
6. `query_design(scope: global)` 返回的 `bindings`：有则按 `_meta.framework` 优先用组件库映射；无则 tokens + 语义结构实现。

无 `.ai/design/profile.json` 时：报告需先执行 `design-sync` 或 `/design-system`。

## 1. 依赖寻址（对每个依赖强制执行）

对列表中的**每一项**，按下面顺序查找，**前一步命中即停止**，禁止臆造类型，禁止未经 MCP 直接打开 `.ai/` 下的文件：

1. **`query_contract`**（`name` = 依赖名）  
   - 命中：记录 TS 类型与 `tsFilePath`，用于后续编码。

2. **若契约未命中** → **`search_arch`**（`query` = 依赖名或「模块 + 依赖名」）  
   - 有结果：选最相关的一条，再 **`query_arch`**（`path` = 返回的 `path`，可加 `#锚点`）精读。  
   - 记录 `summary`、`sourcePath`、关键字段/方法签名。

3. **若仍无结果** → 换同义词、类名、模块名再 **`search_arch`** 一次（最多再试 1 次）。

4. **仅当以上步骤均无法得到可用定义时**，才调用 **`report_missing`** 上报该依赖，并**停止**当前功能开发。

## 2. 开发计划

汇总：功能范围、每个依赖的寻址结果（契约 / 架构文档 + `sourcePath`）、拟改动的模块与文件、风险点。

**等待我说「确认」后再进入实现编排。**

## 2.5 Task 拆分（用户确认后、派发子 Agent 前）

将 §2 计划拆为 **2–5 分钟粒度** 的 Task 列表（逻辑同 `plan-from-spec` Part 2）：

- 每个 Task 含：checkbox 步骤、**MCP**、**Files**（白名单）、**Verify**、可选 **Contracts**
- 写入 `.apt/orchestration/progress.md` 初始账本
- 为 Task 1 准备 `task-1-brief.md`（后续 Task 在 Gate 通过后写 brief）

## 3. 子 Agent 编排实现（必须）

用户确认后：**禁止**亲自写实现代码。遵循 `templates/_subagent-orchestration.md`：

<!-- keep in sync with templates/_subagent-orchestration.md -->

主 Agent **只编排**，禁止亲自实现 Part 2 / 实现 Task 的代码（小范围修 brief、progress、report 路径除外）。

### 0. 子 Agent 能力检查

若当前环境**无法**派发独立子 Agent（如 Cursor `Task`、Claude Code 子代理）：**停止**，提示换支持子 Agent 的环境。**禁止**退化为 inline 实现。

### 1. SDD 与 APT 叠加

- 若可用 **superpowers `subagent-driven-development`** Skill：**优先加载**，按其 implementer → review → fix 节奏。
- **APT 规则优先于 SDD 冲突项**：MCP 寻址、Task 微闭环、`audit_arch_changes` 仅主 Agent 最终一次、每 Task commit、串行 Gate。

### 2. 账本与 brief（防 compaction 丢状态）

1. 确保 `.apt/orchestration/` 存在；维护 **`progress.md`**（Task 列表、状态、commit SHA、report 路径）。
2. 每 Task 开始前写 **`task-N-brief.md`**（从 Task 列表摘录：步骤、MCP、Files、Verify、Contracts）。
3. 记录 **`BASE_SHA`**（派发 implementer 前 `HEAD`）。

有 superpowers 时可用其 `scripts/task-brief`、`scripts/review-package`；**progress 以 APT 账本为准**。

### 3. 串行循环（每个 Task）

**上一 Task Gate 未过，不得派发下一 Task。禁止并行两个 implementer。**

对每个未完成 Task：

#### 3.1 派发 Implementer

- Prompt 基于 `_subagent-implementer-prompt.md`（内联或引用）。
- 附上 brief 路径、Files 白名单、Verify、report 路径、BASE_SHA 上下文。
- 内联 **`_task-micro-closeout.md`** 微闭环要求。

#### 3.2 Implementer 回报后

- 若 `BLOCKED` / `NEEDS_CONTEXT` → 停住问用户或补上下文，**不**进 review。
- 若 `DONE` / `DONE_WITH_CONCERNS` → 继续。

#### 3.3 Task Review Gate

1. 生成 review 包：`git diff BASE_SHA..HEAD` 或 superpowers `review-package`。
2. 派发 **Task Reviewer**（`_subagent-reviewer-prompt.md`）。
3. **Spec ✅ 且 Quality Approved** → 更新 `progress.md`（DONE + commit + report）→ **下一 Task**。
4. **未通过** → 派发 **fix 子 Agent**（同 implementer 规则，附 reviewer 意见）；**最多 2 轮** fix。仍失败 → **BLOCKED**，停住问用户。

### 4. Handoff 报告格式

子 Agent 写满 `.apt/orchestration/task-N-report.md`（格式见 `_subagent-orchestration.md`）。主 Agent 短回报仅含：Status、commits、一行测试摘要、report 路径。

## 4. 最终闭环（必须）

全部 Task Gate 通过后：

1. **不要**等待 `/finish-feature`。
2. **立即**执行下列闭环（禁止跳过）。
3. 最终报告单独列出 **「闭环摘要」**。

<!-- keep in sync with templates/_feature-closeout.md -->

你已完成核心实现，**必须**执行下列闭环（禁止跳过）。

### 0. 架构变更同步（必须）

1. 调用 **`audit_arch_changes`**（默认 `since: last-scan`）。无 `last-scan.json` 时报告需先 `start-init`。
2. 对 **`modified`** 每一项：调用 **`refresh_asset`**（`sourcePath` 必填）。禁止仅用旧 summary 调 `register_asset` 代替。
3. 对 **`new`** / **`unregistered`**：调用 **`refresh_asset`**（从源码入库）。
4. 对 **`deleted`**：调用 **`remove_asset`**（`assetId` 或 `sourcePath`）。
5. 若四类皆空：在报告中写明「无架构资产变更」。

可选补救：在项目根执行 `sync-changes` 或 `sync-changes --dry-run` 预览。

### 1. TS 契约（若有对外 TS 类型）

1. 检查是否新建可供外部调用的接口、类或函数。
2. 确保 `src/contracts/` 或对应目录有严格 TS 类型定义。
3. 每个新契约调用 **`register_contract`**（`name`, `description`, `tsFilePath`）。

### 2. 闭环后自检（简要）

完整验收请运行 **`/verify`**。此处仅做闭环后最小确认：

- 每个 `register_contract`：确认 `.ai/INDEX.md` 已更新。
- 每个 refresh/remove：用 **`search_arch`** 抽检 1–2 项；精读用 **`query_arch`**。
- 输出 **闭环摘要**：audit 统计、已 refresh 的 assetId 列表、已注册契约列表。

闭环摘要输出后，**建议**提示用户运行 **`/verify`** 做完整验收门禁。

若本次仅做计划、尚未派发子 Agent，则不要执行闭环。
