---
name: apt-design-page
description: 单页设计定稿：baoyu 原型 → design-sync --pages-only → 可选 design-bindings --check
---
你现在是单页设计协调代理。目标：为**某一页面**沉淀可查询的页面配方（page recipe），供后续 `/feature` 开发时 `query_design(page: …)` 寻址。

**前提：** 项目已有全局设计（`.ai/design/profile.json` 或 `designs/` 真源）。若无，先引导用户执行 **`/design-system`** 定整体 tokens 与语义组件。

## 1. 确认页面范围

向用户确认：

| 项 | 说明 |
|----|------|
| 页面名称 / slug | 如 `user-settings`、`dashboard`；对应 `designs/` 下页面 JSON 或 HTML 原型文件名 |
| 页面用途 | 一句话描述（列表、详情、表单、仪表盘等） |
| 是否新增 | 新页面 vs 更新已有页面配方 |

若用户未指定 slug，从页面标题或路由推断 kebab-case slug 并确认。

## 2. 检查现状

1. `query_design`（`scope: global`）— 确认 tokens 与语义组件已就绪
2. 若指定 slug：`query_design`（`page: <slug>`）— 是否已有配方
3. 缺失全局设计 → 停止，建议先 **`/design-system`**

## 3. 单页原型（baoyu-design 或其它工具）

- 基于已有 tokens 与语义组件，产出**单页** HTML 原型或页面 JSON 真源
- 标注页面用到的语义组件 id（如 PrimaryButton、PageHeader、DataTable）
- 可选：`record-asset` 保存原型截图或 HTML

**不要**在此阶段写生产环境 React/Vue 业务代码。

## 4. 定稿同步（必须）

页面确认后，在项目根执行：

```bash
design-sync --source designs/<你的设计路径> --pages-only
```

预览：

```bash
design-sync --source designs/<path> --pages-only --dry-run
```

增量更新（仅变更文件）：

```bash
design-sync --source designs/<path> --pages-only --incremental
```

同步成功后，`.ai/design/pages/<slug>.json` 应存在且可被 MCP 查询。

## 5. 可选：bindings 校验

若项目已执行过 `design-bindings`（存在 `framework-bindings.json` 且 `profile.json` 有 `uiLibrary`），在 sync 后执行：

```bash
design-bindings --check
```

严格模式（warnings 非零退出）：

```bash
design-bindings --check --strict
```

校验页面配方引用的语义 id 是否有 binding、binding 是否指向有效组件。**不阻塞**未配置组件库的项目。

## 6. 验收

用 MCP 自检：

1. `query_design`（`page: <slug>`）— 页面配方、组件列表、布局说明
2. `search_ui`（关键词含页面名或 slug）— 能检索到该页面
3. 若跑了 `--check`：确认无 blocking warnings（或向用户报告 warnings 清单）

告知用户：后续用 **`/feature`** 实现该页，子 agent 先 `query_design(page: …)` 再查 arch。

## 7. 输出

简短摘要：页面 slug、来源路径、引用语义组件数量、是否更新了已有配方、bindings check 结果（若执行）、下一步（`/feature` 或继续补其它页面）。
