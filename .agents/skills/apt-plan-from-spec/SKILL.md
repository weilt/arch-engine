---
name: apt-plan-from-spec
description: 从 brainstorming spec 生成 APT 实现方案（MCP 寻址 + 可执行任务），不写代码
---
你是 APT 规划代理。用户已完成 brainstorming 并产出 **design spec**。你的任务是：基于 spec 做 **MCP 硬寻址**，写出 **双 Part 实现方案**，保存到 `docs/apt/plans/`，**禁止在本命令中写生产代码**。

用户应提供 spec 路径（如 `docs/superpowers/specs/2026-06-17-foo-design.md`）。若未提供，先询问。

## 0. 读取 spec（允许）

1. 读取用户给出的 **spec 文件**（仅此文件与后续要写入的 plan 文件可直接读；**禁止**未经 MCP 打开 `.ai/` 下其它文件）。
2. 提取：**Goal**、范围、非目标、依赖清单、是否含前端 UI、验收标准。
3. 从 spec 推导本功能所需的每一个技术依赖（接口、组件、类、工具、枚举、API、语义 UI 组件等），列出名称。

## 0.5 设计寻址（spec 含前端 UI 时必须）

在 §1 之前执行。禁止臆造色值/字号/圆角。

1. **`query_design`**（`scope: "global"`）— 记录 tokens 与 `style.md` 约束。
2. **`query_design`**（`page: <slug>`）— 读页面配方；若无，**`search_ui`** 找最接近模板。
3. 列出所需**语义组件**，逐个 **`query_design`**（`component: <id>`）。
4. 缺定义 → **`report_design_gap`**，**停止**（不写入 plan 的 UI 实现任务；可保留纯后端任务并标注阻塞项）。
5. 无 `.ai/design/profile.json` → 报告需先 `design-sync` 或 `/design-system`。

## 1. 依赖寻址（对 §0 中每一项强制执行）

对每一项依赖，**前一步命中即停止**，禁止臆造：

1. **`query_contract`**（`name`）
2. 未命中 → **`search_arch`** → **`query_arch`**（`path` + 可选锚点）
3. 再试一次同义词 **`search_arch`**（最多 1 次）
4. 仍无 → **`report_missing`**，**停止规划**（不产出含该依赖的虚假任务）

记录：来源（contract / arch）、`tsFilePath` 或 `sourcePath`、`summary`、关键签名。

## 2. 写入 Plan 文件（方案 C — 双 Part）

在 `docs/apt/plans/` 创建文件：`YYYY-MM-DD-<slug>-plan.md`（slug 来自 spec 文件名或功能简称）。

**必须严格使用下列结构：**

```markdown
# <功能名> Implementation Plan

> **Spec:** `<spec 相对项目根路径>`
> **Command:** `/plan-from-spec`
> **Status:** draft

**Goal:** <一句话，来自 spec>

**Architecture:** <2-3 句技术路线>

---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束
（来自 spec，含非目标）

### 1.2 设计寻址（无 UI 则写 N/A）
| 项 | MCP 结果 | 约束摘要 |
|----|----------|----------|

### 1.3 依赖寻址表
| 依赖 | 来源 | 引用（tsFilePath / sourcePath / path） | 摘要 |
|------|------|----------------------------------------|------|

### 1.4 拟改动模块与文件
| 文件/模块 | 变更类型 | 说明 |
|-----------|----------|------|

### 1.5 风险与未决项

---

## Part 2 — 可执行任务清单

> 每步 2–5 分钟粒度；实现时由 `/implement-plan` 按序执行。

### Task 1: <标题>
- [ ] <步骤 1>
  - **MCP:** `query_arch` path=`…` 或 `query_contract` name=`…` 或 `query_design` component=`…`
  - **Files:** `path/to/file`
- [ ] <步骤 2>
  - **Verify:** 如何验证本 task

### Task 2: …
```

**Part 2 要求：**

- 每个 Task 至少一个 checkbox 步骤
- 凡涉及已有契约/架构/设计，步骤必须带 **MCP** 引用（不得空写类名）
- 含测试与验证步骤；是否需要 TDD 按 spec 约定，默认关键逻辑有测试步骤
- **不要**写「提交 git」步骤，除非用户明确要求

## 3. 交付与门禁

1. 告知用户 plan 的**完整路径**。
2. 在聊天中用 5–10 行摘要 **Part 1**（寻址结论 + 主要改动文件 + 风险）。
3. 写明：**请审阅 plan 文件并说「确认」后，使用 `/implement-plan <plan路径>` 开始编码；实现完成后使用 `/verify <plan路径>` 验收。**
4. **Status** 保持 `draft`，直到用户确认；用户确认后在 plan 内把 `Status` 改为 `approved`（仅改该行，仍不写代码）。

若 spec 与寻址冲突，以 MCP 实证为准，在 Part 1.5 列出需回填 spec 的项。

**禁止：** 写生产代码、执行闭环（`audit_arch_changes` 等）、调用 `writing-plans`。
