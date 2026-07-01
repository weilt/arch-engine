---
name: apt-v0-handoff
description: v0 页面逻辑冻结：开发对照 v0 成品与 PM 文档逐页写 manifest/logic、更新 _pages.md、单页 design-sync；禁止写 src/ 业务代码
---
你是 **Phase A 页面逻辑冻结** 代理。目标：对照 PM 交付的 v0 成品与设计文档，逐页沉淀 `page.manifest.json` + `page.logic.md`，经开发认定 `approved` 后入库，供 Phase B `plan-from-spec` 批量实现。

**PM 仅交素材**（v0 链接/导出 `page.tsx`/截图 + `docs/` 设计文档）。**不**要求 PM 写双文件或审 logic。`status: approved` 由 **开发/TL** 认定逻辑已按 PM 设计说清楚。

**硬约束：** 本 Skill **只写** `designs/v0/<page-id>/` 与 `designs/v0/_pages.md`。**禁止**写 `src/` 下任何业务代码。

---

## 0. 前置

| 输入 | 说明 |
|------|------|
| v0 成品 | 链接、导出 `page.tsx`、截图；可平铺于 `designs/v0-inbox/` |
| PM 设计文档 | PRD、流程、权限、业务规则（仓库内 `docs/` 等） |
| 进度表 | `designs/v0/_pages.md` — 开发维护的 SSOT |

若全局设计未就绪：先引导 **`/design-system`**，再开始 handoff。

---

## 1. 每页一轮（禁止批量糊 logic）

**一次只处理一个 `page-id`。** 完成下列 8 步后再开下一页。

### 步骤 1 — 确认 `page-id`

从 v0 标题/路由 + PM 文档推断 **kebab-case** `page-id`（须与后续 `page.manifest.json` 的 `id`、目录名一致），**与用户确认**。

若 `_pages.md` 尚无该行，先追加一行（`handoff: pending`，`approved: no`，`synced: no`）。

### 步骤 2 — 查询全局语义组件

执行 MCP：

```
query_design(scope: global)
```

记录返回的语义组件 id，**禁止臆造**。当前项目示例（以 MCP 为准）：

| 场景 | 语义组件 id |
|------|-------------|
| 主操作按钮 | `PrimaryButton` |
| 次操作/取消 | `SecondaryButton` |
| 页头 | `PageHeader` |
| 内容容器 | `Card` |
| 列表空态 | `EmptyState` |
| 列表加载 | `SkeletonList` |
| 表单输入 | `Input` |
| 错误提示 | `Alert` |

列表页常见组合：`PageHeader` + `Card` + `PrimaryButton` + `EmptyState` + `SkeletonList`。

### 步骤 3 — 创建/更新页面目录

对照 v0 控件布局与 PM 文档，创建或更新：

```text
designs/v0/<page-id>/
  page.manifest.json   # 必填
  page.logic.md        # 必填
  page.tsx             # 推荐：从 v0 导出
  preview.html         # 可选
```

### 步骤 4 — 写入双文件（draft → approved）

先写 **`status: draft`**，核对 PM 文档与 v0 无误后改为 **`status: approved`**，并填写 `reviewedBy`、`reviewedAt`（开发/TL 认定，非 PM 签字）。

#### `page.manifest.json` 字段

| 字段 | 说明 |
|------|------|
| `id` | kebab-case，与目录名一致 |
| `pageType` | `list` \| `form` \| `detail` \| `dashboard` \| `auth` \| `settings` \| `wizard` \| `custom` |
| `feature` | 功能域 slug，如 `user-management` |
| `title` | 中文页面标题 |
| `route` | 前端路由，如 `/users` |
| `description` | 一句话说明页面用途 |
| `v0Url` | 可选，v0 原型链接 |
| `status` | 初稿 `draft`；核对后 `approved` |
| `reviewedBy` | approved 时必填（开发/TL 标识） |
| `reviewedAt` | approved 时必填（ISO 8601） |

不确定的字段写 **`TBD`**，并在 `page.logic.md` 末尾「待确认」列出。

**pageType 推断：** 表格+分页 → `list`；输入框+提交 → `form`；详情只读 → `detail`。

#### `page.logic.md` 结构

```markdown
# <页面标题>

## 操作明细
| 操作 | 触发 | 结果 |
|------|------|------|

## 主流程
1. …

## 状态
- loading / empty / error …

## 依赖
- API 意向名（如 `listUsers`、`deleteUser`）— Phase B 经 `query_contract` 寻址，此处仅为意向
- 语义组件 id（须来自步骤 2 的 `query_design(scope: global)`，如 PageHeader、EmptyState）
```

从 v0 视觉稿标注控件对应的语义组件 id；**不得**引用 global 查询中不存在的 id。

### 步骤 5 — logic 完整性检查

确认 `page.logic.md` **必须**包含：

1. **操作明细表**（操作 | 触发 | 结果）
2. **主流程**（编号步骤）
3. **状态**（loading / empty / error 等）
4. **§依赖** — API **意向名** + 语义组件 id

缺项则补全后再进入步骤 6。

### 步骤 6 — 拷入 v0 源码并 design-sync

1. 将 v0 导出的 **`page.tsx`**（及可选 `preview.html`）放入 `designs/v0/<page-id>/`
2. 在项目根执行 **单页** 同步：

```bash
design-sync --adapter v0 --source designs/v0/<page-id>
```

预览（可选）：

```bash
design-sync --adapter v0 --source designs/v0/<page-id> --dry-run
```

同步后：`.ai/design/pages/<id>.json`、`.ai/design/logic/<id>.md`、`.ai/design/refs/<id>.tsx`（若有）。

### 步骤 7 — 自检并更新 `_pages.md`

1. MCP 自检：

```
query_design(page: <page-id>)
```

确认含 `pageType`、`feature`、`logicMarkdown`。`status !== approved` 时 `gaps` 含 **`manifest-not-approved`** — Phase B 开发须 `report_design_gap`，不得写 UI。

2. 更新 `designs/v0/_pages.md` 对应行：

| 列 | 取值 |
|----|------|
| `handoff` | 双文件写完 → `done`；进行中 → `wip`；未开始 → `pending` |
| `approved` | 开发认定逻辑已说清楚 → `yes`；否则 `no` |
| `synced` | 步骤 6 成功 → `yes`；否则 `no` |
| `notes` | 待对文档、权限、接口等待办 |

### 步骤 8 — 禁止写 `src/`

本 Skill 结束于设计真源与进度表。**不得**在本轮修改 `src/`、实现 API 或生产 UI。实现归属 Phase B（`plan-from-spec` → `implement-plan`）。

---

## 2. 禁止项

- **不要**生成或修改 `src/` 下生产代码
- **不要**臆造已不存在的 API 签名；未知接口写 `TBD` 并在 notes 备注
- **不要**臆造语义组件 id；必须以 `query_design(scope: global)` 为准
- **不要**一次为多页批量写 logic（逐页人工核对）
- **不要**在 logic 未冻结时进入 Phase B

---

## 3. Phase A 结束门禁

以下 **全部** 满足才允许 `/plan-from-spec` 进入全页实现：

1. `_pages.md` 中 **每一行** `approved = yes`
2. 每页存在 `page.manifest.json`、`page.logic.md`
3. 执行 `design-sync --adapter v0 --source designs/v0` 成功
4. 抽检每页 `query_design(page:)`：`gaps` 不含 `manifest-not-approved`、`missing-logic`

未通过门禁 → **停止**，继续逐页 handoff。

---

## 4. 输出

每页完成后简短摘要：

- `page-id`、title、`handoff` / `approved` / `synced` 状态
- 引用的语义组件 id 列表
- `query_design(page:)` gaps（若有）
- 下一页建议或「Phase A 已全部 approved，可撰写 rollup spec」
