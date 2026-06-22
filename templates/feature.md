---
description: 单命令全流程：寻址 → 计划 → 实现 → 自动闭环（推荐）
model: sonnet
---

你现在是专业子代理，即将开发新功能。请严格按以下步骤执行，禁止跳过。

**若用户已有 brainstorming spec 与 `docs/apt/plans/` 方案：** 改用 **`/implement-plan`**，不要重复本命令的寻址与计划。

用户只需描述功能；**不要**让用户选择「走契约还是 arch」——由你自动寻址。

## 0. 任务与依赖

分析任务，列出开发所需的每一个依赖（接口、组件、类、工具、枚举、API 等），写出名称即可。

## 0.5 设计寻址（本任务含前端 UI 时必须）

在 §1 之前执行。禁止臆造色值/字号/圆角；禁止未经 MCP 直接读 `.ai/design/`。

1. **`query_design`**（`scope: "global"`）— 记录 tokens 与 `style.md` 约束。
2. **`query_design`**（`page: <本页 slug>`）— 读页面配方；若无，**`search_ui`** 找最接近的页面/组件模板。
3. 列出本页需要的**语义组件**，逐个 **`query_design`**（`component: <id>`）。
4. 若缺组件/页面定义 → **`report_design_gap`**，**停止 UI 实现**（可先写接口与纯逻辑）。
5. 无 `framework-bindings.json` 时：用 tokens + 语义结构实现；有则优先用映射库。

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

**等待我说「确认」后再写代码。**

## 3. 实现与自动闭环（必须）

用户确认后进入实现。当实现完成且可以交付时：

1. **不要**等待用户输入 `/finish-feature`。
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

若本次仅做计划、尚未写代码，则不要执行闭环。
