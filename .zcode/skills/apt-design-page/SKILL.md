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

---

## 附录 A：v0 页面 Handoff（两阶段工厂 Phase A）

适用：PM 在 v0 完成视觉稿后，由**开发**逐页沉淀「页面是什么功能」+ 操作逻辑，供 Phase B 批量实现时 `query_design(page: …)` 寻址。

**主路径：** Codex **`apt-v0-handoff`**；Cursor 等通过 `.agents/skills/apt-v0-handoff/`。PM **仅交** v0 成品与设计文档，**不写** `page.manifest.json` / `page.logic.md`。

### A.1 PM 交付（仅素材）

| 交付物 | 说明 |
|--------|------|
| v0 成品 | 链接、导出 `page.tsx`、截图；可平铺于 `designs/v0-inbox/` |
| 设计文档 | PRD、流程、权限、业务规则（仓库内 `docs/` 等） |

### A.2 开发逐页 handoff（`apt-v0-handoff`）

进度 SSOT：`designs/v0/_pages.md`（开发维护）。

每页一轮（**禁止**批量糊 logic）：

1. 确认 `page-id`（kebab-case，与用户确认）
2. `query_design(scope: global)` — 记录语义组件 id
3. 对照 v0 控件 + PM 文档，创建 `designs/v0/<page-id>/`
4. 开发写入 **`page.manifest.json`** + **`page.logic.md`**（`draft` → 核对后 `approved`，`reviewedBy` / `reviewedAt` 由开发/TL 认定）
5. 推荐拷入 v0 导出的 **`page.tsx`**（及可选 `preview.html`）
6. 单页 `design-sync --adapter v0 --source designs/v0/<page-id>`；`query_design(page:)` 自检；更新 `_pages.md`

内联字段规则见 **`templates/v0-visual-handoff-prompt.md`**（Agent 写字段参考，非 PM 必跑流程）。

目录结构：

```
designs/v0/_pages.md     # 进度表（开发维护）
designs/v0/<page-id>/
  page.manifest.json   # 必填：id、pageType、feature、route、status 等
  page.logic.md        # 必填：操作明细、主流程、状态、依赖
  page.tsx             # 推荐：v0 导出 React 源码
  preview.html         # 可选
```

### A.3 Phase A 结束门禁

全部页面 `approved = yes` 且双文件齐全后，在项目根执行：

```bash
node scripts/check-v0-freeze.mjs
```

**exit 0（PASS）** 才允许 Phase B（rollup spec → `/plan-from-spec` → `/implement-plan`）。

### A.4 定稿同步

单页：

```bash
design-sync --adapter v0 --source designs/v0/<page-id>
```

批量（扫描 `designs/v0/*` 下含 manifest 的子目录）：

```bash
design-sync --adapter v0 --source designs/v0
```

预览：

```bash
design-sync --adapter v0 --source designs/v0/<page-id> --dry-run
```

同步后：`.ai/design/pages/<id>.json`、`.ai/design/logic/<id>.md`、`.ai/design/refs/<id>.tsx`（若有）。

### A.5 验收

1. `query_design`（`page: <page-id>`）— 应含 `pageType`、`feature`、`logicMarkdown`
2. `status !== approved` 时 `gaps` 含 **`manifest-not-approved`** — 开发须 `report_design_gap`，不得写 UI
3. 无 `page.tsx` 时 `gaps` 含 **`no-implementation-ref`**

## 7. 输出

简短摘要：页面 slug、来源路径、引用语义组件数量、是否更新了已有配方、bindings check 结果（若执行）、下一步（`/feature` 或继续补其它页面）。
