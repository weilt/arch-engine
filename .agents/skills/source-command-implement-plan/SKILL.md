---
name: "source-command-implement-plan"
description: "按已批准的 APT plan 编排子 Agent 串行实现并自动闭环（配合 /plan-from-spec）"
---

# source-command-implement-plan

Use this skill when the user asks to run the migrated source command `implement-plan`.

## Command Template

你是 **APT 编排代理**（非 inline 编码者）。用户已用 **`/plan-from-spec`** 生成实现方案，并说「确认」开始编码。

用户应提供 plan 路径（如 `docs/apt/plans/2026-06-17-foo-plan.md`）。若未提供，先询问。

## 0. 前置检查

1. 读取 plan 文件（允许直接读 plan；**禁止**未经 MCP 读 `.ai/` 下其它文件来「猜」依赖）。
2. 确认头部 **`Status: approved`**。若为 `draft`，**停止**并提示用户先审阅 plan 并确认。
3. 以 **Part 1** 为技术真源，**Part 2** 为执行顺序；**不得**重新臆造依赖、路径或 UI 样式（与 Part 1 冲突时先报告用户）。

## 1. 子 Agent 编排（必须）

**禁止**亲自按 Part 2 写实现代码。对每个 Task 派发全新子 Agent，严格串行。

<!-- keep in sync with templates/_subagent-orchestration.md -->

主 Agent **只编排**，禁止亲自实现 Part 2 / 实现 Task 的代码（小范围修 brief、progress、report 路径除外）。

### 0. 子 Agent 能力检查

若当前环境**无法**派发独立子 Agent（如 Cursor `Task`、Codex 子代理）：**停止**，提示换支持子 Agent 的环境。**禁止**退化为 inline 实现。

### 1. SDD 与 APT 叠加

- 若可用 **superpowers `subagent-driven-development`** Skill：**优先加载**，按其 implementer → review → fix 节奏。
- **APT 规则优先于 SDD 冲突项**：MCP 寻址、Task 微闭环、`audit_arch_changes` 仅主 Agent 最终一次、每 Task commit、串行 Gate。

### 2. 账本与 brief（防 compaction 丢状态）

1. 确保 `.apt/orchestration/` 存在；维护 **`progress.md`**（Task 列表、状态、commit SHA、report 路径）。
2. 每 Task 开始前写 **`task-N-brief.md`**（从 plan Part 2 摘录：步骤、MCP、Files、Verify、Contracts）。
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

## 2. 最终闭环（必须）

全部 Task Gate 通过后：

1. **不要**等待 `/finish-feature`。
2. **立即**执行下列闭环（见 `templates/_feature-closeout.md`）。
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

闭环摘要输出后，**建议**提示用户运行 **`/verify <plan路径>`** 做完整验收门禁。
