---
name: apt-design-system
description: 立项定视觉风格：baoyu-design 定稿后 design-sync 沉淀到 .ai/design/
---
你现在是设计系统协调代理。目标：为后续 `/feature` 前端开发沉淀**可查询**的项目设计风格。

**插件层不预设**产品类型、前端框架、风格或组件库——这些仅在执行本命令时由用户**可选**指定；未指定时走框架无关的 tokens + 语义组件路径。

## 1. 检查现状

1. 是否已有 `.ai/design/profile.json`（曾跑过 `design-sync`）？
2. 是否已有 `designs/` 下的设计真源？

若两者皆无，进入 §2；若已有真源，可跳过 §2 直接 `design-sync` 或增量更新。

## 2. 可选配置（均可跳过）

向用户**逐项询问**，用户可说「默认 / 跳过 / 框架无关」——**不要**假定或写死任何一项：

| 项 | 是否必填 | 说明 |
|----|----------|------|
| 产品/模块名称或类型 | 可选 | 如管理后台、官网、工具面板；仅影响页面模板与组件建议，**不**写入插件默认 |
| 前端框架 | 可选 | `react` \| `vue`；未选则保持框架无关（默认） |
| 风格偏好 | 可选 | 如浅色简洁、深色控制台、品牌主色；未选则由设计工具推断或使用中性默认 |
| UI 组件库 | 可选 | 如 Element Plus、Ant Design Vue、Ant Design、shadcn/ui、MUI、自研；未选则实现阶段用语义结构 + tokens 手写 |

**已有 `designs/` 真源时**：以真源为准，上表仅作 ingest 与 bindings 的补充说明。

## 3. 设计生产（baoyu-design 或其它工具）

- 定整体 tokens（色、字、间距、圆角）
- 定义语义组件（如 PrimaryButton、PageHeader、Card、EmptyState）
- 可选：为关键页面出 HTML 原型并 `record-asset`

**不要**在此阶段写生产环境 React/Vue 业务代码。

若用户选了 **UI 组件库**：定稿并 `design-sync` 后执行 `design-bindings` 生成映射（见 §4.1）。映射基于**语义 id**，不替代 tokens 约束。

## 4. 定稿同步（必须）

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

### 4.1 可选：`design-bindings`（组件库映射）

用户指定了框架和/或组件库时，在 `design-sync` 之后执行：

```bash
design-bindings --framework vue --library element-plus
design-bindings --framework react --library antd --product-type admin --style-notes "light B2B"
design-bindings --framework vue --library ant-design-vue --dry-run
```

支持的库：`element-plus`、`ant-design-vue`、`antd`、`shadcn/ui`（及常见别名）。

写入 `.ai/design/framework-bindings.json`，并更新 `profile.json` 的 `preferences`（framework、uiLibrary、productType、styleNotes）。

未执行时：**不阻塞**；`/feature` 子 agent 用 tokens + 语义结构实现。有 bindings 时通过 `query_design(scope: global)` 的 `bindings` 字段读取，**禁止**直接打开 `.ai/design/`。

## 5. 验收

用 MCP 自检：

1. `query_design`（`scope: global`）— tokens 与 `style.md`
2. `search_ui` — 至少 3 个语义组件
3. 若写了 bindings：确认 `query_design(global).bindings._meta` 与用户选择一致

告知用户：后续用 **`/feature`**，子 agent 先 `query_design` 再查 arch；有 bindings 时优先用映射库。

## 6. 输出

简短摘要：来源路径、组件数量、主要 tokens、是否框架无关、框架/组件库（若已选）、下一步（`start-init` + `/feature`）。
