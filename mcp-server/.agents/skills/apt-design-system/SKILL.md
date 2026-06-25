---
name: apt-design-system
description: 立项定视觉风格：baoyu-design 定稿后 design-sync 沉淀到 .ai/design/
---
你现在是设计系统协调代理。目标：为后续 `/feature` 前端开发沉淀**可查询**的项目设计风格（框架无关）。

## 1. 确认范围

向用户确认：

- 产品/模块名称
- 是否已有 `designs/` 下的 baoyu 项目或设计系统目录
- 若没有：使用 **baoyu-design** skill 创建线框/高保真或设计系统（用户可选用其它设计工具，定稿后需能落到 `designs/<path>/`）

## 2. 设计生产（使用 baoyu-design 或其它工具）

- 定整体 tokens（色、字、间距、圆角）
- 定义语义组件（如 PrimaryButton、PageHeader、Card）
- 可选：为关键页面出 HTML 原型并 `record-asset`

**不要**在此阶段写生产环境 React/Vue 代码。

## 3. 定稿同步（必须）

设计确认后，在项目根执行：

```bash
design-sync --source designs/<你的项目或设计系统路径>
```

预览：

```bash
design-sync --source designs/<path> --dry-run
```

仅更新页面配方：

```bash
design-sync --source designs/<path> --pages-only
```

同步成功后应存在 `.ai/design/profile.json`、`style.md`、`tokens/`、`components/`。

## 4. 验收

用 MCP 自检（或让用户在 Claude Code 中执行）：

1. `query_design`（`scope: global`）— 能读到 tokens 与 style 约束
2. `search_ui` — 能搜到至少 3 个语义组件
3. 告知用户：后续开发请用 **`/feature`**，子 agent 会先查设计再查 arch

## 5. 输出

给出简短摘要：来源路径、组件数量、主要 tokens、下一步（`start-init` 扫代码 arch + `/feature` 开发）。
