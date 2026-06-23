# APT Phase 3：Spec → 实现方案（方案 C）

**日期:** 2026-06-17  
**状态:** 已批准（用户选择方案 C）  
**关系:** 衔接 superpowers `brainstorming` 产出的 spec；**替代** `writing-plans` 作为实现方案编写步骤  
**痛点:** `writing-plans` 不读 `.ai/` 索引与契约，实现方案易与仓库脱节  

---

## 1. 目标

在 brainstorming 产出 **design spec** 之后、编码之前，插入 APT 原生规划阶段：

```text
brainstorming → spec（docs/superpowers/specs/…）
       ↓
/plan-from-spec  →  APT plan（docs/apt/plans/…）  ← MCP 寻址硬约束
       ↓ 用户确认
/implement-plan  →  按 plan 编码 + 自动闭环
```

**方案 C 产出物包含两层：**

| 层级 | 内容 | 作用 |
|------|------|------|
| **Part 1 — 技术方案** | 范围、设计/契约/架构寻址表、拟改文件、风险 | APT 强项：与索引对齐 |
| **Part 2 — 可执行任务** | checkbox 步骤（2–5 分钟粒度）、每步标注 MCP 引用与文件 | 保留 superpowers 可执行性 |

---

## 2. 非目标

- 不替代 brainstorming（仍负责需求与 design spec）
- 不在 plan 阶段写生产代码
- 不合并 `docs/superpowers/plans/` 历史文件（新 plan 统一放 `docs/apt/plans/`）
- MVP 不做 plan 文件的机器校验 schema（靠模板约束）

---

## 3. 新斜杠命令

### 3.1 `/plan-from-spec`

**输入：** 用户给出 spec 路径（默认约定 `docs/superpowers/specs/YYYY-MM-DD-*-design.md`）

**允许读取：** 该 spec 文件（输入真源）；**禁止**未经 MCP 读 `.ai/` 下其它文件。

**步骤：**

1. 精读 spec，提取目标、范围、依赖、是否含 UI
2. 若含 UI → 设计寻址（同 `/feature` §0.5）
3. 对每个技术依赖 → 契约/架构寻址（同 `/feature` §1）
4. 遇缺失 → `report_design_gap` / `report_missing` 并**停止**（不产出「假 plan」）
5. 写入 `docs/apt/plans/YYYY-MM-DD-<slug>-plan.md`（双 Part 结构）
6. 在聊天中摘要 Part 1，**等待用户「确认」**；未确认前禁止编码

### 3.2 `/implement-plan`

**输入：** 已批准的 plan 路径（`docs/apt/plans/…-plan.md`）

**步骤：**

1. 以 plan Part 1 为真源，Part 2 为执行顺序；**不重新臆造**依赖与路径
2. **主 Agent 编排**：按 Part 2 每个 Task **串行派发子 Agent**（implementer → Task Reviewer → 可选 fix，最多 2 轮）；每 Task 含 TDD/测试、微闭环、`git commit`；**禁止**主 Agent inline 实现
3. 全部 Task Gate 通过后执行 `_feature-closeout.md` 闭环（`audit_arch_changes` 仅此时一次）
4. 输出闭环摘要；建议 `/verify`

详见 [子 Agent 编排 spec](2026-06-22-apt-subagent-orchestration-design.md)。

### 3.3 与现有命令关系

| 命令 | 何时用 |
|------|--------|
| `/plan-from-spec` + `/implement-plan` | 已有 brainstorming spec（**推荐第三阶段**） |
| `/feature` | 无 spec、口头描述功能的一站式流程 |
| `/start-feature` | 无 spec、仅需寻址+计划（legacy，可被 plan 流程替代） |
| `/finish-feature` | 闭环漏跑补救 |

---

## 4. Plan 文件约定

**路径：** `docs/apt/plans/YYYY-MM-DD-<slug>-plan.md`

**头部元数据（必填）：**

```markdown
# <功能名> Implementation Plan

> **Spec:** `docs/superpowers/specs/….md`
> **Command:** `/plan-from-spec`
> **Status:** draft | approved

**Goal:** …
```

**Part 1** 须含：设计寻址（若适用）、依赖寻址表（含 MCP 引用）、拟改动文件、风险。

**Part 2** 须含：`- [ ]` 任务；每任务注明相关 `sourcePath` / 契约名 / `component` id。

---

## 5. Brainstorming 衔接

superpowers `brainstorming` 终端状态由：

```text
invoke writing-plans
```

改为：

```text
用户审阅 spec 通过后 → /plan-from-spec <spec路径>
```

不在 APT 仓库内修改 superpowers 插件；在 `docs/claude-code-best-practices.md` 与 README 中写明团队约定。

---

## 6. 验收

- [ ] `templates/plan-from-spec.md`、`implement-plan.md` 经 `agent-init` 注入
- [ ] 对已有 spec 跑 `/plan-from-spec` 能产出双 Part plan 且寻址经 MCP
- [ ] 用户确认后对 plan 跑 `/implement-plan` 能编码并闭环
- [ ] README 命令一览含 6 个斜杠命令

---

## 7. 下一步

实现模板与文档更新；业务项目 `agent-init` 后即可使用。
