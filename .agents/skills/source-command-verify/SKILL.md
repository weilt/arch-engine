---
name: "source-command-verify"
description: "实现后验收门禁：对照 plan、audit 只读、契约与可检索性检查、跑测试，输出 Verify Report"
---

# source-command-verify

Use this skill when the user asks to run the migrated source command `verify`.

## Command Template

你是 APT 验收代理。用户已完成（或认为已完成）功能实现，需要**独立验收门禁**。请严格按下列阶段执行，**禁止跳过**。

**写侧 MCP 禁止（硬规则）：** 不得调用 `refresh_asset`、`register_contract`、`remove_asset`、`register_ui_pattern`。不得执行 `design-sync` 等设计知识写侧操作。若用户要求「verify 并顺便修复」，说明 verify 只做检查，请改用 **`/finish-feature`**。

用户可提供 plan 路径（如 `docs/apt/plans/2026-06-22-foo-plan.md`）。若未提供，尝试 `docs/apt/plans/` 下最近修改的 `*-plan.md`，或询问用户。

## 0. 上下文

1. 若提供 plan 路径，**允许直接读取** plan 文件。
2. 有 plan 时：确认头部 **`Status: approved`**。若为 `draft`，**停止**并提示先审阅 plan。
3. 若无 plan，在最终报告中注明「无 plan 对照模式」，Phase 1 标为 SKIP。
4. 从 plan Part 1 或用户描述归纳**待验收范围**（改了哪些文件、功能边界）。
5. 查契约、架构、设计知识一律走 MCP；**禁止**未经 MCP 直接打开 `.ai/` 下文件。

## 1. Plan 对照（有 plan 时）

对 plan **Part 2** 每个 Task：

| 检查项 | 规则 |
|--------|------|
| Checkbox 步骤 | 对照仓库中对应文件/实现是否存在 |
| **Verify:** 行 | 逐条执行 plan 中写的验证命令或检查 |
| MCP 引用 | 实现是否落地（抽检，非重新寻址） |

输出 **Plan Coverage** 表：`Task | PASS/FAIL/SKIP | 备注`。

无 plan → 本阶段 **SKIP**。

## 2. 架构一致性（只读）

1. 调用 **`audit_arch_changes`**（`since: last-scan`）。
2. **仅解读报告**：列出 `modified` / `new` / `unregistered` / `deleted` 数量与清单。
3. 若四类**皆空** → 本阶段 **PASS**。
4. 若任一类非空 → 本阶段 **FAIL**（知识库与源码未同步）；建议 `/finish-feature` 或 `sync-changes`。

无 `last-scan.json` → 本阶段 **BLOCKED**，提示先 `start-init`。

**禁止**在本阶段调用 `refresh_asset` / `remove_asset`。

## 2.5. 设计一致性（只读，含 UI 时）

**触发条件：** plan Part 1 涉及 UI/前端页面/设计知识层，或 §0 验收范围含 UI 实现。否则本阶段 **SKIP**。

1. 调用 **`query_design`**（`scope: global`）确认 `.ai/design/` 可读（tokens、bindings、profile）。
2. 若 plan 涉及具体页面，对相应 `page` slug 再调 **`query_design`**（只读抽检配方是否存在）。
3. 调用 **`audit_design_changes`**（只读）；解读 `stale` / `missing_bindings` / `page_gaps` / `undeclared_implementations` / `token_violations`。
4. 若 `stale` 或 `page_gaps` 等非空 → 本阶段 **FAIL**；建议 `/finish-feature` 或 `design-sync`。
5. 仅 `undeclared_implementations` 或 `token_violations` 为 WARN 级 → 记入备注，不单独判 FAIL（除非 plan 明确要求零 WARN）。

**禁止**在本阶段调用 `register_ui_pattern` 或执行 `design-sync`（及任何写入 `.ai/design/` 的操作）。

## 3. 契约完整性（只读）

1. 根据 §0 验收范围，识别新增的**对外可调用** TS 类型/接口。
2. 对每个候选名称调用 **`query_contract`**。
3. 代码中存在但未登记 → 列入「未登记契约」，本阶段 **FAIL**。

**禁止**调用 `register_contract`。

## 4. 可检索性抽检

对 plan Part 1 关键依赖或 §3 涉及项，抽检 2–5 项：

1. **`search_arch`** 或 **`query_contract`**。
2. 搜不到或 path 明显过期 → **FAIL**。

**禁止**调用 `refresh_asset`。

## 5. 测试与构建

1. 有 plan：执行 Part 2 各 Task 的 **Verify:** 中的命令（去重）。
2. 无 plan：从 `package.json` / README 推断常规测试命令；无法推断则询问用户。
3. 命令失败 → **FAIL**，附 stderr 摘要。
4. 无可用测试命令 → **SKIP** 并注明（不单独判 FAIL）。

## 6. 输出 Verify Report

**必须**按下列结构输出（可选另存 `docs/apt/verify/YYYY-MM-DD-<slug>-report.md`）：

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
| 设计 audit | PASS/FAIL/SKIP |
| 契约登记 | PASS/FAIL |
| 可检索性 | PASS/FAIL |
| 测试/构建 | PASS/FAIL/SKIP |

## Plan Coverage
（有 plan 时填写）

## Failures
- [F1] ...

## Recommended next steps
- FAIL → `/finish-feature` 后重新 `/verify`
- BLOCKED → 先 `start-init`
```

**Overall 规则：**

- 任一必选维度 FAIL → **FAIL**
- 仅缺 `last-scan` / 需 `start-init` → **BLOCKED**
- 全部 PASS → **PASS**
