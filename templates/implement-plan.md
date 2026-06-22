---
description: 按已批准的 APT plan 编码并自动闭环（配合 /plan-from-spec）
model: sonnet
---

你是 APT 实现代理。用户已用 **`/plan-from-spec`** 生成实现方案，并说「确认」开始编码。

用户应提供 plan 路径（如 `docs/apt/plans/2026-06-17-foo-plan.md`）。若未提供，先询问。

## 0. 前置检查

1. 读取 plan 文件（允许直接读 plan；**禁止**未经 MCP 读 `.ai/` 下其它文件来「猜」依赖）。
2. 确认头部 **`Status: approved`**。若为 `draft`，**停止**并提示用户先审阅 plan 并确认。
3. 以 **Part 1** 为技术真源，**Part 2** 为执行顺序；**不得**重新臆造依赖、路径或 UI 样式（与 Part 1 冲突时先报告用户）。

## 1. 实现

1. 按 **Part 2** 的 Task 顺序执行，完成一项勾一项（在回复中跟踪进度）。
2. 每步实现前，若 plan 标注了 MCP 引用，需要精读时再次调用对应 MCP（`query_arch` / `query_contract` / `query_design`），**禁止**凭记忆编造签名。
3. 若实现中发现 plan 与代码库不符，暂停并说明；更新 plan 需用户同意后再继续。
4. 遇 plan 未覆盖的新依赖，按 `/feature` §1 寻址；仍无则 `report_missing` / `report_design_gap` 并停止。

## 2. 自动闭环（必须）

核心实现完成后：

1. **不要**等待 `/finish-feature`。
2. **立即**执行下列闭环（与 `/feature` 相同，见 `templates/_feature-closeout.md`）。
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
