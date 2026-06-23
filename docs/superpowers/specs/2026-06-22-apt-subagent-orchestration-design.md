# APT 子 Agent 编排：implement-plan / feature

**日期:** 2026-06-22  
**状态:** 已批准（用户审阅 2026-06-22）  
**关系:** 落实 `/implement-plan`、`/feature` 实现阶段的原始设计初衷；与 `/verify`、`/finish-feature` 衔接  
**方案:** 主 Agent 编排 + 每 Task 全新子 Agent 串行 + Task 级完整编码微循环 + 复用 superpowers SDD

---

## 1. 目标

1. **主 Agent 只编排**，不亲自写大段实现代码，避免单会话上下文爆炸。
2. **每个 Task 派一个全新子 Agent**（fresh context），**严格串行**；上一 Task Gate 未过不得派下一个。
3. **每个子任务 = 完整编码微循环**：只读 MCP 寻址 → TDD/测试 → 实现 → 测试绿 → **Task 级契约/架构登记** → handoff →（主 Agent 派发）task review。
4. **复用 superpowers `subagent-driven-development`（SDD）** 的 implementer / task-reviewer 流程；APT `_` 模板片段为 **MCP + 微闭环** 的强制叠加层。
5. 全部 Task 完成后，**主 Agent** 执行 `_feature-closeout.md` 最终 sweep + 建议 `/verify`。

**用户决策摘要（对话确认）：**

- 子 Agent 可用**只读 MCP**（`query_contract` / `search_arch` / `query_arch` / `query_design`）
- 子 Agent 在 Task 末执行 **写侧登记**：`register_contract`、`refresh_asset`、`remove_asset`（仅限本 Task 范围）
- **每 Task 子 Agent `git commit` 一次**（对齐 SDD，便于 `review-package`）
- `audit_arch_changes` **仅主 Agent** 在全 Task 结束后执行一次
- 设计初衷不可变：做完一个 Task、更新库、回报主 Agent，再启动下一个

---

## 2. 非目标

- 不修改 `mcp-server` / `arch-engine` 核心逻辑
- 不把 superpowers 全文复制进 APT 仓库（引用 Skill + 提供 fallback 片段）
- 不并行派发两个**实现**子 Agent（reviewer/fixer 与 implementer 不并行）
- 不让 `/verify` 承担实现编排（verify 仍为读侧验收门禁）
- 不在本阶段改 `plan-from-spec` 双 Part 结构（仅强化 Part 2 Task 字段与 SDD 注释）

---

## 3. 背景与动机

### 3.1 现状差距

| 现状 | 问题 |
|------|------|
| `templates/implement-plan.md` §1 要求主 Agent inline 按 Task 实现 | 与「子 Agent 串行」初衷不符 |
| `templates/feature.md` §3 用户确认后主 Agent 自己实现 | 长功能易上下文爆炸 |
| 子 Agent 模式仅存在于内部 plan（arch-sync、arch-scan-v2） | 未进入命令 SSOT |

### 3.2 与 superpowers SDD 的关系

| 层级 | 职责 |
|------|------|
| **superpowers:subagent-driven-development** | 编排节奏：implementer → review-package → task reviewer → fix loop；TDD；每 Task commit；progress ledger |
| **APT `_subagent-orchestration.md` 等** | 强制：MCP 寻址规则、Task 微闭环（register/refresh/remove）、串行、Files 白名单、与 `/verify` 衔接 |
| **冲突时** | **APT MCP / 契约规则优先** |

主 Agent 编排时：**若环境可用 SDD Skill，优先加载**；否则遵循 APT fallback 片段。

### 3.3 与 `/verify`、`/finish-feature` 的分工

```text
子 Agent（每 Task）  →  register / refresh / remove（Task 范围内）
主 Agent（全 Task 后）→  audit_arch_changes + 补漏 sweep（_feature-closeout）
/verify               →  读侧验收报告（不替代 Task 内测试）
/finish-feature       →  verify FAIL 或漏跑闭环时的写侧补救
```

---

## 4. 架构：每 Task 微循环

```text
主 Agent
  ├─ 前置：读 plan / 寻址+计划（feature §0–2）
  ├─ 写 task-N-brief.md + 记录 BASE_SHA
  ├─ 派发 Implementer 子 Agent
  │     ├─ 只读 MCP
  │     ├─ TDD → 实现 → 测试绿
  │     ├─ Task 微闭环：register / refresh / remove
  │     ├─ git commit
  │     └─ task-N-report.md + 短回报
  ├─ review-package(BASE..HEAD) → 派发 Task Reviewer 子 Agent
  ├─ Spec ✅ 且 Quality Approved → 更新 progress.md → 下一 Task
  └─ 全部 Task 后：_feature-closeout → 建议 /verify
```

**每 Task 最多子 Agent 轮次：** implementer → reviewer →（可选）fixer；fix **最多 2 轮**；仍失败 → **BLOCKED**，停住问用户。

---

## 5. 角色与 MCP 权限

### 5.1 主 Agent（编排代理）

| 允许 | 禁止 |
|------|------|
| 读 plan、写 brief/progress、派发子 Agent | 亲自实现 Part 2 / 实现 Task 代码 |
| 跑 `review-package`、Gate、最终 `_feature-closeout` | 并行两个 implementer |
| `audit_arch_changes`（最终一次） | 跳过 task review |

### 5.2 Implementer 子 Agent

| 阶段 | 动作 |
|------|------|
| A 编码 | 只读 MCP；TDD（推荐加载 `superpowers:test-driven-development`）；仅改 **Files 白名单** |
| B 微闭环 | 本 Task 新契约 → `register_contract`；本 Task 改动且已索引路径 → `refresh_asset`；本 Task 删除 → `remove_asset` |
| C 交付 | 写 `task-N-report.md`；**git commit**；回报 ≤15 行 |

| 允许 | 禁止 |
|------|------|
| 只读 MCP + Task 写侧登记 | `audit_arch_changes` |
| 白名单内文件读写 | 改其它 Task 文件 |
| 本 Task 相关测试 | 无用户授权的 force push |

### 5.3 Task Reviewer 子 Agent

- 读 brief + report + diff 文件（不重复跑全量测试，除非有具体疑点）
- 输出：**Spec 合规** + **代码质量** 双 verdict（对齐 SDD `task-reviewer-prompt.md`）
- 只读 checkout，不 mutate git 状态

---

## 6. 模板与文件变更

### 6.1 新增内部片段（`_` 前缀，不进入 `PUBLIC_TEMPLATES`）

| 文件 | 用途 |
|------|------|
| `templates/_subagent-orchestration.md` | 主 Agent 编排规则、SDD 引用、串行、ledger、派发流程 |
| `templates/_task-micro-closeout.md` | 子 Agent Task 末：register / refresh / remove |
| `templates/_subagent-implementer-prompt.md` | SDD implementer 精简版 + APT 扩展（无 superpowers 时 fallback） |
| `templates/_subagent-reviewer-prompt.md` | SDD task-reviewer 精简版 + APT 契约/refresh 验收项 |

### 6.2 修改公开命令模板

| 文件 | 变更要点 |
|------|----------|
| `templates/implement-plan.md` | 身份改为「编排代理」；§1 → SDD 循环；§2 最终 closeout |
| `templates/feature.md` | §0–2 主 Agent；**§2.5** 产出 Task 列表 + brief 文件；§3 SDD 循环；§4 最终 closeout |
| `templates/plan-from-spec.md` | Part 2 每 Task 必填 **Files**、**Verify**、**MCP**、可选 **Contracts**；注明 implement-plan 按 Task 派子 Agent |

### 6.3 运行时产物（项目内，gitignore 建议）

| 路径 | 用途 |
|------|------|
| `.apt/orchestration/progress.md` | Task 完成账本（防 compaction 后重复派发） |
| `.apt/orchestration/task-N-brief.md` | Task 需求真源 |
| `.apt/orchestration/task-N-report.md` | 子 Agent 详细报告 |

有 superpowers 时，可选用其 `scripts/task-brief`、`scripts/review-package`；**progress 以 APT 账本为准**。

---

## 7. plan Part 2 Task 字段约定

每个 Task 必须包含：

```markdown
### Task N: <标题>
- [ ] <步骤>
  - **MCP:** `query_arch` path=`…` 或 `query_contract` name=`…`
  - **Files:** `path/a`, `path/b`（白名单）
  - **Verify:** `npm test -- …` 或具体验证命令
  - **Contracts:** （可选）`TypeName` → `src/contracts/foo.ts`
```

粒度：**2–5 分钟**一步；过大 Task 编排失效。

---

## 8. Handoff 报告格式（子 Agent → 主 Agent）

```markdown
## Task N Report

**Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT

### Tests
- Command: …
- Result: …
- TDD RED/GREEN: （若适用）

### APT Micro-closeout
- ContractsRegistered: [name → tsFilePath]
- AssetsRefreshed: [sourcePath]
- AssetsRemoved: [sourcePath | assetId]

### FilesChanged
- …

### Commits
- <short-sha> <subject>

### Blockers / Concerns
- …
```

主 Agent 短回报仅含：Status、commits、一行测试摘要、report 路径。

---

## 9. 平台差异与降级

| 平台 | 子 Agent 机制 | 无机制时 |
|------|---------------|----------|
| Claude Code / Cursor | `Task` tool（`generalPurpose`） | **停止**，提示换支持子 Agent 的环境 |
| Codex | 独立 `apt-*` Skill 会话 | 同上 |
| Qoder | 同 Claude 命令路径 | 同上 |

**禁止**在主 Agent 无子 Agent 能力时退化为 inline 实现（违背设计初衷）。

---

## 10. 与内部 plan 的差异说明

[`2026-06-16-arch-sync-changes` plan](../plans/2026-06-16-arch-sync-changes.md) 对 **APT 插件自举** 规定「子 Agent 禁止 MCP」。本 spec 针对 **业务项目**（已 `agent-init`、MCP 可用）：子 Agent **允许只读 MCP + Task 级写侧登记**。两处不矛盾，场景不同。

---

## 11. 文档同步

| 文件 | 变更 |
|------|------|
| `README.md` | 工作原理加「实现阶段子 Agent 串行编排」 |
| `docs/claude-code-best-practices.md` | 新小节「子 Agent 编排」 |
| `templates/_agents-md-snippet.md` | 推荐流程补一句 |
| `docs/superpowers/specs/2026-06-17-apt-plan-from-spec-design.md` | §3.2 回填子 Agent 编排（1 段） |
| `templates/apt-deck.md` | 维护者 checklist（可选） |

---

## 12. 验收标准

- [x] `_subagent-orchestration.md` 等 4 个片段存在且被 feature / implement-plan 引用
- [x] 两命令模板：主 Agent 禁止 inline 实现；含 SDD implementer + reviewer 双派发
- [x] 子 Agent 模板含 TDD → 测试绿 → register/refresh/remove 微闭环 + **每 Task commit**
- [x] `plan-from-spec` Part 2 含 Files / Verify / MCP 强制说明
- [x] `inject-platform-assets.test.js` 仍 8/8 pass；`_` 片段不出现在 `.claude/commands/`
- [x] 文档与模板一致；与 `/verify` 职责无冲突

---

## 13. 实现顺序（供 writing-plans / implement-plan 使用）

1. 本 spec 用户批准  
2. 新增 4 个 `_` 片段  
3. 改 `implement-plan.md` → `feature.md` → `plan-from-spec.md`  
4. 文档同步 + `inject-platform-assets`  
5. 狗食：用本 spec 对应 plan 跑一轮 `/implement-plan`（可选）

---

## 14. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 子 Agent 成本高（每 Task 2–3 次调用） | 接受；换上下文隔离与 Gate 质量 |
| Task 过大仍爆上下文 | plan Part 2 强制 2–5 分钟粒度；Gate 不通过则拆 Task |
| 双 refresh（Task + 最终 audit） | Task 只 refresh 白名单；audit 补漏 |
| 无 superpowers 环境 | APT fallback 片段自包含 |
| compaction 后重复派发 | `.apt/orchestration/progress.md` + `git log` 恢复 |
