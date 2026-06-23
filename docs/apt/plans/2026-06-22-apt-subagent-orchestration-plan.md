# APT 子 Agent 编排 Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-06-22-apt-subagent-orchestration-design.md`
> **Command:** `/plan-from-spec`
> **Status:** approved

**Goal:** 将 `/implement-plan` 与 `/feature` 实现阶段改为主 Agent 编排 + 每 Task 全新子 Agent 串行；Task 级 TDD/微闭环/commit；全 Task 后主 Agent `_feature-closeout`；复用 superpowers SDD。

**Architecture:** 纯模板变更。新增 4 个 `_` 内部片段；改 3 个公开命令模板与文档；`inject-platform-assets` 分发（`_` 片段不进入 `.claude/commands/`）。

---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束

**范围内：**

- 新增 `templates/_subagent-orchestration.md`、`_task-micro-closeout.md`、`_subagent-implementer-prompt.md`、`_subagent-reviewer-prompt.md`
- 改 `templates/implement-plan.md`、`feature.md`、`plan-from-spec.md`
- 改 `README.md`、`docs/claude-code-best-practices.md`、`templates/_agents-md-snippet.md`
- 回填 `docs/superpowers/specs/2026-06-17-apt-plan-from-spec-design.md` §3.2
- `.gitignore` 增加 `.apt/orchestration/`
- `node scripts/inject-platform-assets.cjs` 再分发公开模板

**非目标（spec §2）：**

- 不改 `mcp-server` / `arch-engine`
- 不复制 superpowers 全文进仓库
- 不并行 implementer；无子 Agent 能力时不退化 inline

### 1.2 设计寻址

N/A（Prompt 模板，无 UI）。

### 1.3 依赖寻址表

| 依赖 | 来源 | 引用 | 摘要 |
|------|------|------|------|
| `_feature-closeout` | 源码 | `templates/_feature-closeout.md` | 主 Agent 全 Task 后最终 sweep |
| `inject-platform-assets` | 源码 | `scripts/inject-platform-assets.cjs` | `PUBLIC_TEMPLATES` 不含 `_` 片段 |
| SDD 参考 | 外部 | superpowers `subagent-driven-development` | 编排节奏；APT 片段为 MCP 叠加 |
| verify 分工 | spec | `2026-06-22-apt-verify-command-design.md` | Task 内测试；`/verify` 读侧验收 |

### 1.4 拟改动模块与文件

| 文件 | 变更 |
|------|------|
| `templates/_subagent-*.md` ×4 | 新增 |
| `templates/implement-plan.md` | 编排代理 + SDD 循环 |
| `templates/feature.md` | §2.5 Task 拆分 + §3 编排 |
| `templates/plan-from-spec.md` | Part 2 Files/Verify/MCP 强制 |
| `README.md` | 工作原理子 Agent 说明 |
| `docs/claude-code-best-practices.md` | 新小节 |
| `templates/_agents-md-snippet.md` | 推荐流程一句 |
| `docs/superpowers/specs/2026-06-17-apt-plan-from-spec-design.md` | §3.2 回填 |
| `.gitignore` | `.apt/orchestration/` |

---

## Part 2 — 可执行任务清单

### Task 1: 新增 4 个 `_` 编排片段

- [x] 创建 `_subagent-orchestration.md`、`_task-micro-closeout.md`、`_subagent-implementer-prompt.md`、`_subagent-reviewer-prompt.md`
  - **Files:** `templates/_subagent-orchestration.md`, `templates/_task-micro-closeout.md`, `templates/_subagent-implementer-prompt.md`, `templates/_subagent-reviewer-prompt.md`
  - **Verify:** 四文件存在且内容覆盖 spec §4–§8
  - **MCP:** N/A

### Task 2: 改 `implement-plan.md` 与 `feature.md`

- [x] `implement-plan.md`：身份改为编排代理；§1 内联 `_subagent-orchestration`；§2 最终 closeout
- [x] `feature.md`：§2.5 Task 拆分；§3 子 Agent 编排；§4 最终 closeout
  - **Files:** `templates/implement-plan.md`, `templates/feature.md`
  - **Verify:** grep 确认无「主 Agent inline 按 Task 实现」表述
  - **MCP:** N/A

### Task 3: 改 `plan-from-spec.md` Part 2 约定

- [x] Part 2 强制 Files / Verify / MCP；注明子 Agent 串行与自动 commit
  - **Files:** `templates/plan-from-spec.md`
  - **Verify:** Part 2 示例含 Files + Verify
  - **MCP:** N/A

### Task 4: 文档与 gitignore

- [x] 更新 README、best-practices、`_agents-md-snippet`、plan-from-spec design §3.2；`.gitignore` 加 `.apt/orchestration/`
  - **Files:** `README.md`, `docs/claude-code-best-practices.md`, `templates/_agents-md-snippet.md`, `docs/superpowers/specs/2026-06-17-apt-plan-from-spec-design.md`, `.gitignore`
  - **Verify:** 文档描述与模板一致
  - **MCP:** N/A

### Task 5: 平台分发与测试

- [x] 运行 `inject-platform-assets.cjs`；`inject-platform-assets.test.js` 8/8
  - **Files:** `scripts/inject-platform-assets.cjs`（仅当需改时）
  - **Verify:** `node --test scripts/inject-platform-assets.test.js`；`.claude/commands/` 无 `_subagent-*`
  - **MCP:** N/A
