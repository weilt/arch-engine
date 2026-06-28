# Project Agents

本文件由 APT `agent-init` 维护。智能体请遵循下方工作流。

<!-- apt-workflow:start -->
## APT Workflow

开发任务须通过 MCP 工具查询项目知识，禁止臆造类型或未经 MCP 直接读取 `.ai/` 索引文件。

### 命令 / Skill 对照

| 场景 | Claude / Cursor / Qoder / ZCode | Codex |
|------|----------------------------------|-------|
| 一站式功能开发 | `/feature` | `apt-feature`（ZCode 亦可用 `$apt-feature`） |
| Spec → 方案 | `/plan-from-spec` | `apt-plan-from-spec` |
| 按方案实现 | `/implement-plan` | `apt-implement-plan` |
| 实现后验收 | `/verify` | `apt-verify` |
| 闭环补救 | `/finish-feature` | `apt-finish-feature` |
| 设计系统同步 | `/design-system` | `apt-design-system` |
| 单页设计定稿 | `/design-page` | `apt-design-page` |
| 自主闭环主入口 | `/apt-goal` | `apt-goal`（ZCode 亦可用 `$apt-goal`） |
| AI brainstorming | `/auto-brainstorm` | `apt-auto-brainstorm` |
| 当前进度 | `/current-status` | `apt-current-status` |

### 推荐流程

- 有产品目标（完整产品）优先 `/apt-goal`（强制全流程，含 brainstorm/spec/plan/implement/verify 闭环）；其余路径不变。
- 已有 brainstorming spec：`/plan-from-spec` → 用户确认 → `/implement-plan`（**每 Task 子 Agent 串行**）→ `/verify`（FAIL 则 `/finish-feature`）
- 无 spec：口头描述 → `/feature`（实现阶段同上）→ `/verify`（FAIL 则 `/finish-feature`）

### 依赖寻址（对每个依赖）

1. `query_contract`（按名称）
2. 未命中 → `search_arch` → `query_arch` 精读
3. 仍无 → 换同义词再 `search_arch` 一次
4. 仍无 → `report_missing` 并停止

### 含 UI 时（先于依赖寻址）

1. `query_design`（`scope: global`）
2. `query_design`（`page` / `component`）
3. 缺失 → `report_design_gap` 并停止 UI 实现

### 完成后闭环（必须）

1. `audit_arch_changes`
2. `modified` → `refresh_asset`；`new`/`unregistered` → `refresh_asset`；`deleted` → `remove_asset`
3. 新对外 TS 类型 → `register_contract`
4. 交付前建议 `/verify` 验收
5. `/verify` 报告落盘 `.apt/verify/latest.md`，`loopDone` 依赖其 PASS。

终端：`start-init`（架构）、`design-sync`（设计）、`sync-changes`（批量架构同步）。
<!-- apt-workflow:end -->
