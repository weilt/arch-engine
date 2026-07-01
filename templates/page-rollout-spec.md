# <产品名> 页面批量实现 Rollup Spec

> **类型:** Phase B rollup spec（页面工厂）  
> **前置:** Phase A 已全部完成（见 §1）  
> **编排:** `/plan-from-spec` → 用户确认 → `/implement-plan`（每页串行）→ `/verify`

---

## 1. Phase A 完成声明（硬门禁）

**以下全部满足后，方可撰写本 spec 并进入 Phase B：**

- [ ] `designs/v0/_pages.md` 中**每一行** `approved = yes`
- [ ] 每页存在 `designs/v0/<page-id>/page.manifest.json` 与 `page.logic.md`
- [ ] 已执行 `design-sync --adapter v0 --source designs/v0` 成功
- [ ] `node scripts/check-v0-freeze.mjs` **exit 0（PASS）**

**`_pages.md` 快照（撰写时 commit 或摘录）：**

| page-id | title | handoff | approved | synced | notes |
|---------|-------|---------|----------|--------|-------|
| `<page-id>` | `<中文标题>` | done | yes | yes | |
| … | … | … | yes | … | |

> 任一行 `approved ≠ yes` 或 `check-v0-freeze` FAIL → **禁止**进入 `/plan-from-spec` 全页实现。

---

## 2. Goal 与范围

**Goal:** <一句话：本批次要交付的页面能力与业务价值>

**纳入范围：**

- <列出本 rollup 包含的 page-id 及核心能力>

**非目标：**

- <明确不做的项，如 3.0 多栈、v0 API 自动拉取等>

---

## 3. 页面清单与 Feature 域划分

| page-id | title | feature 域 | logic 路径 | 备注 |
|---------|-------|------------|------------|------|
| `<page-id>` | `<中文标题>` | `<如：用户中心 / 订单>` | `designs/v0/<page-id>/page.logic.md` | |
| … | … | … | `designs/v0/…/page.logic.md` | |

**域说明：**

- **`<feature 域 A>`：** <该域包含的 page-id、共用能力摘要>
- **`<feature 域 B>`：** …

> 实现时经 **`query_design(page:)`** 读 logic 与配方；**禁止**直读 `.ai/design/` 臆造。

---

## 4. 跨页约束

| 约束类型 | 说明 |
|----------|------|
| **共用 layout** | <如：管理后台统一侧栏、顶栏> |
| **权限** | <角色/鉴权规则；各页 logic §权限 须一致> |
| **路由前缀** | <如：`/admin/*`、`/app/*`> |
| **其它** | <共享状态、导航入口、面包屑等> |

---

## 5. 每页 logic 引用（SSOT）

实现前须对下表每一页执行 `query_design(page: <page-id>)`，以冻结 logic 为**唯一业务真相来源**：

| page-id | logic 路径 | 关键依赖（意向名，B1 寻址） |
|---------|------------|------------------------------|
| `<page-id>` | `designs/v0/<page-id>/page.logic.md` | `<API 意向名、语义组件 id>` |
| … | … | … |

**偏离规则：** 实现与 logic 不一致时，**先改** `page.logic.md` → 单页 `design-sync` → 再改代码；**禁止**静默漂移。

---

## 6. Phase B 编排说明

```text
check-v0-freeze PASS
  → /plan-from-spec <本 spec 路径>
  → 用户确认 plan（Status: approved）
  → /implement-plan（每页 Task 串行子 Agent）
  → /verify
  → /finish-feature（若 FAIL）
```

### 6.1 每页标准 Task 拆分（plan Part 2）

每个 `page-id` 至少覆盖下列能力（小页可合并 Task，但不得省略能力）：

| Task | 名称 | 内容 |
|------|------|------|
| **B1** | 依赖与接口 | `query_design(page:)` 读 logic；对每个 API 意向名：`query_contract` → `search_arch` → `query_arch`；无命中则 `query_impact` / `query_ontology` 定落点 → 新建 API/client → `register_contract` / `refresh_asset` |
| **B2** | 前端页面 | `query_design` global + 语义组件；按 `refs/<id>.tsx` + bindings 实现；**以冻结 logic 为 SSOT**；`gaps` 含 blocking → `report_design_gap`，停 UI |
| **B3** | 页级闭环 | `register_ui_pattern`；本 Task 触及的 arch `refresh_asset`；子 Agent 微闭环 |

**接口规则：** 禁止凭 logic 或 v0 mock 臆造签名；以 MCP 寻址结果为准。

### 6.2 实现顺序建议

1. 按 feature 域或依赖关系排序 page-id（无环依赖优先）。
2. 每页串行：**B1 → B2 → B3**（或 plan 中合并后的等价 Task）。
3. 全批次结束后统一 `/verify`；`loopDone` 依赖 verify PASS + audit 空。

---

## 7. 验收标准

- [ ] 本 spec §3 所列页面均已实现且可访问
- [ ] 各页 `query_design(page:)` 无 blocking `gaps`
- [ ] 新建/变更契约与 arch 已 `register_contract` / `refresh_asset`
- [ ] `/verify` **PASS**

---

## 8. 风险与未决项

| 项 | 说明 | 处理 |
|----|------|------|
| | | |
