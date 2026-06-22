# APT 命令调整：移除 `/start-feature`，新增 `/verify`

**日期:** 2026-06-22  
**状态:** 草案（待用户审阅）  
**关系:** 精简六命令 lineup；补「实现后验收门禁」；与 `/finish-feature` 形成检查→修复分工  
**方案:** `/verify` 读侧验收报告 + 保留 `/finish-feature` 写侧补救 + 删除 `/start-feature`

---

## 1. 目标

1. **移除** `/start-feature`（及 Codex `apt-start-feature`），消除与 `/feature` 的功能重叠与文档矛盾。
2. **新增** `/verify`（及 `apt-verify`），作为实现后的**验收门禁**：对照 plan、检查 `.ai/` 一致性、跑验证步骤，输出结构化 **Verify Report**。
3. **重新定位** `/finish-feature`：当 `/verify` 未通过或实现流程漏跑闭环时使用（写侧补救）。
4. 更新 `templates/`、`AGENTS.md` 片段、README、多平台分发（`inject-platform-assets.cjs`），保持 **仍为 6 个公开工作流命令**。

**用户决策摘要（对话确认）：**

- `/start-feature` 独立价值低，同意去掉
- 新增 `/verify` 作为验收门禁（读为主），不替代 `/finish-feature`（写为主）
- 六命令 lineup 更新为：plan / implement / feature / design / **verify** / finish

---

## 2. 非目标

- 不新增 MCP 工具（复用现有 13 个）
- 不修改 `mcp-server` / `arch-engine` 核心逻辑
- `/verify` **默认不执行** `refresh_asset` / `register_contract` / `remove_asset`（避免与 finish 职责混淆）
- 不在本阶段改 `plan-from-spec` 的双 Part 结构（仅补充「实现后请 `/verify`」指引）
- 不合并 `/verify` 与 `/finish-feature` 为单命令（slash 命令阶段保持边界清晰）

---

## 3. 背景与动机

### 3.1 为何要移除 `/start-feature`

| 问题 | 说明 |
|------|------|
| 与 `/feature` 重叠 | 两者均含寻址 → 计划 → 实现 → 自动闭环；`/feature` 另含 §0.5 设计寻址与 spec 分流 |
| 文档与模板矛盾 | README 写「仅寻址与计划（legacy）」，模板却含 §3 实现与闭环 |
| 推荐路径已覆盖 | 无 spec → `/feature`；有 spec → `/plan-from-spec` → `/implement-plan` |

### 3.2 为何要新增 `/verify`

| 缺口 | 说明 |
|------|------|
| Plan Part 2 有 `Verify:` | `plan-from-spec` 要求每 task 写验证步骤，但无独立命令执行验收 |
| 闭环 §2 嵌在实现里 | `_feature-closeout.md` 的「验证」小节未独立暴露给用户 |
| 无 PR/交付前门禁 | 用户无法单独问「做完了吗、达标吗」而不触发写库操作 |

### 3.3 `/verify` vs `/finish-feature`

```text
/verify          →  检查员（读 + 跑测试 + 报告 PASS/FAIL）
/finish-feature  →  修复员（audit → refresh/remove → register）
```

---

## 4. 新六命令 lineup

| # | 命令 | Codex Skill | 角色 |
|---|------|-------------|------|
| 1 | `/plan-from-spec` | `apt-plan-from-spec` | 有 spec → MCP 寻址 → 写 plan |
| 2 | `/implement-plan` | `apt-implement-plan` | 按 approved plan 实现 + 自动闭环 |
| 3 | `/feature` | `apt-feature` | 无 spec 一站式 |
| 4 | `/design-system` | `apt-design-system` | 立项定视觉 |
| 5 | **`/verify`** | **`apt-verify`** | **实现后验收门禁** |
| 6 | `/finish-feature` | `apt-finish-feature` | verify 失败或闭环漏跑时补救 |

**推荐工作流（更新后）：**

```text
有 spec:
  brainstorming → spec → /plan-from-spec → 审阅 approved
       → /implement-plan → /verify →（FAIL → /finish-feature）

无 spec:
  /feature → /verify →（FAIL → /finish-feature）
```

---

## 5. `/verify` 设计

### 5.1 入口与参数

- **用法：** `/verify` 或 `/verify <plan路径>`
- **plan 路径（可选）：** 默认尝试最近修改的 `docs/apt/plans/*-plan.md`，或询问用户
- **前置：** 项目根已 `agent-init`，MCP 可用；有 plan 时要求 `Status: approved`

### 5.2 执行阶段

代理按序执行，**禁止跳过**；除跑测试外，**禁止**调用写侧 MCP（`refresh_asset`、`register_contract`、`remove_asset`）。

#### Phase 0 — 上下文

1. 若提供 plan 路径，读取 plan（允许直接读 plan 文件；**禁止**未经 MCP 读 `.ai/` 其它文件猜状态）。
2. 若无 plan，在报告中注明「无 plan 对照模式」，跳过 Phase 1 部分检查。
3. 从 plan Part 1 或近期 git 变更（若用户允许）归纳**待验收范围**；无 plan 时由用户消息或最近对话推断功能范围。

#### Phase 1 — Plan 对照（有 plan 时）

对 **Part 2** 每个 Task：

| 检查项 | 规则 |
|--------|------|
| Checkbox 步骤 | 对照代码/文件是否存在对应实现 |
| **Verify:** 行 | 逐条执行 plan 中写的验证方式 |
| MCP 引用 | 标注的步骤是否已在实现中正确落地（抽检，非重新寻址） |

输出：**Plan Coverage** 表（Task | 状态 PASS/FAIL/SKIP | 备注）。

#### Phase 2 — 架构一致性（只读）

1. 调用 **`audit_arch_changes`**（`since: last-scan`）。
2. **仅解读报告**，列出 `modified` / `new` / `unregistered` / `deleted` 计数与清单。
3. 若四类皆非空 → 本阶段 **FAIL**，建议 `/finish-feature` 或 `sync-changes`。

无 `last-scan.json` → **BLOCKED**，提示先 `start-init`。

#### Phase 3 — 契约完整性（只读）

1. 根据 Phase 0 范围，检查是否新增**对外可调用** TS 类型/接口。
2. 对每个候选名称调用 **`query_contract`**。
3. 代码中存在但 `.ai/` 未登记 → **FAIL** 项，列入「未登记契约」。

不调用 `register_contract`。

#### Phase 4 — 可检索性抽检

对 Phase 2/3 中涉及的新 API、资产名（或 plan Part 1 列出的关键依赖）：

1. **`search_arch`** 或 **`query_contract`** 抽检 2–5 项（有 plan 时优先 plan 中列出的）。
2. 搜不到或 path 明显过期 → **FAIL**。

不调用 `refresh_asset`。

#### Phase 5 — 测试与构建

1. 有 plan：执行 Part 2 各 Task 的 **Verify:** 中涉及的测试命令（去重）。
2. 无 plan：运行项目常规测试（如 `npm test` / `mvn test`，从 `package.json` 或 README 推断；无法推断则询问用户）。
3. 命令失败 → **FAIL**，附 stderr 摘要。

### 5.3 Verify Report 格式

代理**必须**以如下结构输出（可写入 `docs/apt/verify/YYYY-MM-DD-<slug>-report.md` 可选，默认聊天输出即可）：

```markdown
# Verify Report

**Plan:** <path 或 N/A>
**Overall:** PASS | FAIL | BLOCKED
**Date:** YYYY-MM-DD

## Summary
| 维度 | 结果 |
|------|------|
| Plan 对照 | PASS/FAIL/SKIP |
| 架构 audit | PASS/FAIL/BLOCKED |
| 契约登记 | PASS/FAIL |
| 可检索性 | PASS/FAIL |
| 测试/构建 | PASS/FAIL/SKIP |

## Failures
- [F1] ...

## Recommended next steps
- （若 FAIL）运行 `/finish-feature` 修复闭环；修复后重新 `/verify`
- （若 BLOCKED）先 `start-init`
```

**Overall 规则：**

- 任一必选维度 FAIL → **FAIL**
- 仅 `start-init` 缺失 → **BLOCKED**
- 全部 PASS → **PASS**

### 5.4 与自动闭环的关系

`/feature` 与 `/implement-plan` **仍保留**文末自动闭环（`_feature-closeout.md`）。  
`/verify` 是**额外门禁**，不替代自动闭环；用于：

- 用户不确定代理是否真跑完闭环
- PR 前独立确认
- plan 中 Verify 步骤的集中执行

---

## 6. `/finish-feature` 调整

### 6.1 新 description（frontmatter）

```yaml
description: 闭环写侧补救（/verify 未通过或 feature/implement-plan 漏跑闭环时使用）
```

### 6.2 正文调整

- 首段改为：若 **`/verify` 报告 FAIL** 或 **`/feature` / `/implement-plan` 未执行闭环**，必须补跑下列步骤。
- 删除对 `/start-feature` 的引用。
- 闭环步骤仍引用 `_feature-closeout.md`（不变）。

### 6.3 `_feature-closeout.md` §2 标题

将「## 2. 验证」改为「## 2. 闭环后自检（简要）」——完整验收交给 `/verify`，避免两处定义漂移。closeout §2 仅保留最小抽检（INDEX 更新、search_arch 抽检），与 verify Phase 3–4 对齐表述。

---

## 7. 移除 `/start-feature`

### 7.1 删除产物

| 路径 | 动作 |
|------|------|
| `templates/start-feature.md` | 删除 |
| `.claude/commands/start-feature.md` | 下次 `agent-init` 不再生成；可文档说明手动删除 |
| `.qoder/commands/start-feature.md` | 同上 |
| `.agents/skills/apt-start-feature/` | 同上 |

### 7.2 `inject-platform-assets.cjs`

`PUBLIC_TEMPLATES` 中：

- 移除 `"start-feature.md"`
- 新增 `"verify.md"`

### 7.3 迁移说明（README）

> **vNext：** `/start-feature` 已移除。无 spec 请用 `/feature`；有 spec 请用 `/plan-from-spec` → `/implement-plan`。实现后请用 `/verify` 验收。

---

## 8. 新增 `templates/verify.md` 要点

```yaml
---
description: 实现后验收门禁：对照 plan、audit 只读、契约与可检索性检查、跑测试，输出 Verify Report
model: sonnet
---
```

正文结构：

1. §0 上下文（plan 路径、无 plan 模式）
2. §1 Plan 对照（Phase 1）
3. §2 架构 audit 只读（Phase 2）
4. §3 契约只读（Phase 3）
5. §4 可检索性抽检（Phase 4）
6. §5 测试/构建（Phase 5）
7. §6 输出 Verify Report（§5.3 格式）
8. **禁止：** `refresh_asset`、`register_contract`、`remove_asset`（除非用户明确说「verify 并修复」，则改口引导 `/finish-feature`）

---

## 9. 文档与片段更新清单

| 文件 | 变更 |
|------|------|
| `templates/_agents-md-snippet.md` | 命令表：删 start-feature，加 verify；推荐流程加 verify |
| `README.md` | 六命令表、工作流图、快速开始 |
| `docs/claude-code-best-practices.md` | 删除 start-feature 引用，加 verify 场景 |
| `AGENTS.md` | 由 agent-init 重注入 |
| `templates/feature.md` | 文末加一句：「建议完成后运行 `/verify`」 |
| `templates/implement-plan.md` | 同上 |
| `templates/plan-from-spec.md` | §3 交付门禁加：「实现后使用 `/verify <plan>`」 |
| `docs/presentations/apt-intro/source.md` | 六命令列表更新（宣讲材料同步） |
| `scripts/inject-platform-assets.test.js` | 更新期望模板集合 |

---

## 10. 架构（不变层）

```text
templates/verify.md  (新增)
templates/start-feature.md  (删除)
       │
       ▼
inject-platform-assets.cjs
       ├── .claude/commands/verify.md
       ├── .qoder/commands/verify.md
       └── .agents/skills/apt-verify/SKILL.md

MCP 工具：无变更（verify 仅用 query/audit/search + 终端测试）
```

---

## 11. 错误处理

| 情况 | 行为 |
|------|------|
| MCP 未连接 | 停止，提示检查 `agent-init` 与 MCP |
| plan Status 为 draft | 停止，提示先审阅并改为 approved |
| 无 last-scan | Phase 2 BLOCKED，其余 phase 可继续但 Overall 最高 BLOCKED |
| 测试命令不存在 | Phase 5 SKIP 并注明，不单独判 FAIL |
| 用户要求 verify 时顺便修复 | 引导 `/finish-feature`，不在 verify 内写库 |

---

## 12. 实现任务清单（供 plan 引用）

1. 新增 `templates/verify.md`
2. 删除 `templates/start-feature.md`
3. 更新 `templates/finish-feature.md`、`_feature-closeout.md`（§2 标题与表述）
4. 更新 `feature.md`、`implement-plan.md`、`plan-from-spec.md` 交叉引用
5. 更新 `_agents-md-snippet.md`
6. 更新 `inject-platform-assets.cjs` + 测试
7. 更新 `README.md`、`docs/claude-code-best-practices.md`
8. 运行 `agent-init` 验证六命令注入；Codex skill `apt-verify` 生成
9. （可选）同步 `docs/presentations/apt-intro/source.md` 与重生成第 8 页幻灯片

---

## 13. 验收标准

- [ ] `templates/` 公开模板仍为 6 个，含 `verify.md`、无 `start-feature.md`
- [ ] `agent-init` 后 `.claude/commands/` 有 `verify.md`，无 `start-feature.md`
- [ ] `/verify` 模板明确禁止写侧 MCP，输出 Verify Report 结构
- [ ] `/finish-feature` 描述指向 verify 失败/漏跑场景，无 start-feature 引用
- [ ] README 与 AGENTS 片段工作流含 `→ /verify`
- [ ] `inject-platform-assets.test.js` 通过

---

## 14. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 老用户习惯 start-feature | README 迁移小节保留一版 |
| verify 与 finish 仍混淆 | 报告末尾固定 Recommended next steps |
| 无 plan 时 verify 过弱 | Phase 0 归纳范围 + Phase 5 跑默认测试 |
| 宣讲 PPT 仍写旧六命令 | 实现时同步 source.md（§12-9） |
