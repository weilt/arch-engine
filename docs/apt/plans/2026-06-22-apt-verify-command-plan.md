# APT Verify 命令 Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-06-22-apt-verify-command-design.md`
> **Command:** `/plan-from-spec`
> **Status:** approved

**Goal:** 移除 `/start-feature`，新增 `/verify` 验收门禁，重新定位 `/finish-feature`，更新模板分发与文档，保持六命令 lineup。

**Architecture:** 纯模板与脚本变更，不改 `mcp-server` / `arch-engine`。新增 `templates/verify.md` 作为 SSOT，经 `inject-platform-assets.cjs` 分发到 Claude/Qoder/Codex；删除 `start-feature.md` 并同步清理本仓库已生成的平台产物。

---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束

**范围内：**

- 新增 `templates/verify.md`（五阶段验收 + Verify Report）
- 删除 `templates/start-feature.md`
- 更新 `finish-feature`、`_feature-closeout`、`feature`、`implement-plan`、`plan-from-spec`、`_agents-md-snippet`
- 更新 `scripts/inject-platform-assets.cjs` 与测试
- 更新 `README.md`、`docs/claude-code-best-practices.md`
- 本仓库 `.claude/`、`.qoder/`、`.agents/skills/` 中移除 `start-feature` / `apt-start-feature`，注入 `verify` / `apt-verify`
- （可选）`docs/presentations/apt-intro/source.md` 六命令列表

**非目标（spec §2）：**

- 不新增 MCP 工具；不改 `mcp-server` / `arch-engine`
- `/verify` 默认不调用 `refresh_asset` / `register_contract` / `remove_asset`
- 不合并 verify 与 finish-feature
- 历史 superpowers spec/plan 文档不批量改写（仅运行时文档）

**无前端 UI** — 设计寻址 N/A。

### 1.2 设计寻址

N/A（本任务为 Prompt 模板与分发脚本，无 UI）。

### 1.3 依赖寻址表

> **说明：** 本仓库根未执行 `agent-init`（`.ai/db.json` 缺失），`search_arch` 因 embedding API key 不可用失败。下表依赖以 **spec §9/§12** 与仓库源码路径为准（APT 工具链自举任务）。

| 依赖 | 来源 | 引用 | 摘要 |
|------|------|------|------|
| `injectPlatformAssets` / `PUBLIC_TEMPLATES` | 源码 | `scripts/inject-platform-assets.cjs` | 公开模板 Set；当前含 `start-feature.md`，需换为 `verify.md` |
| `inject-platform-assets` 测试 | 源码 | `scripts/inject-platform-assets.test.js` | 断言 `PUBLIC_TEMPLATES.size === 6` 及六目录输出 |
| `agent-init` 注入入口 | 源码 | `bin/agent-init.sh`, `bin/agent-init.ps1` | 调用 `inject-platform-assets.cjs`，无硬编码命令列表 |
| `_feature-closeout` 闭环片段 | 源码 | `templates/_feature-closeout.md` | feature/implement-plan/finish-feature 共用；§2 标题需改 |
| `finish-feature` 模板 | 源码 | `templates/finish-feature.md` | 写侧补救；需去 start-feature、指向 verify |
| `feature` / `implement-plan` | 源码 | `templates/feature.md`, `templates/implement-plan.md` | 文末建议 `/verify` |
| `plan-from-spec` 交付门禁 | 源码 | `templates/plan-from-spec.md` | §3 加实现后 `/verify` |
| `AGENTS.md` 工作流片段 | 源码 | `templates/_agents-md-snippet.md` | 命令对照表与推荐流程 |
| MCP `audit_arch_changes` | 文档约定 | README §MCP 工具；spec §5.2 Phase 2 | verify 只读调用，**无代码变更** |
| MCP `query_contract` | 文档约定 | README §MCP 工具；spec §5.2 Phase 3 | verify 只读调用 |
| MCP `search_arch` | 文档约定 | README §MCP 工具；spec §5.2 Phase 4 | verify 只读调用 |
| MCP `register_contract` / `refresh_asset` / `remove_asset` | 文档约定 | `_feature-closeout.md` | verify **禁止**调用；finish-feature 保留 |

### 1.4 拟改动模块与文件

| 文件/模块 | 变更类型 | 说明 |
|-----------|----------|------|
| `templates/verify.md` | 新增 | 验收门禁 SSOT（spec §8 七节结构 + 禁止写侧 MCP） |
| `templates/start-feature.md` | 删除 | 移除 legacy 命令 |
| `templates/finish-feature.md` | 修改 | frontmatter + 首段；去 start-feature |
| `templates/_feature-closeout.md` | 修改 | §2 改「闭环后自检（简要）」 |
| `templates/feature.md` | 修改 | 闭环后建议 `/verify` |
| `templates/implement-plan.md` | 修改 | 同上 |
| `templates/plan-from-spec.md` | 修改 | §3 交付加 `/verify <plan>` |
| `templates/_agents-md-snippet.md` | 修改 | 命令表 + 推荐流程 |
| `scripts/inject-platform-assets.cjs` | 修改 | PUBLIC_TEMPLATES 替换 |
| `scripts/inject-platform-assets.test.js` | 修改 | 仍断言 6 模板；集成测试写入 `verify.md` |
| `README.md` | 修改 | 六命令表、工作流、mermaid、快速开始、迁移说明 |
| `docs/claude-code-best-practices.md` | 修改 | 删 start-feature，加 verify 场景表 |
| `AGENTS.md` | 再生成 | `agent-init` 后由片段注入 |
| `.claude/commands/start-feature.md` | 删除 | 本仓库清理 |
| `.qoder/commands/start-feature.md` | 删除 | 本仓库清理 |
| `.agents/skills/apt-start-feature/` | 删除 | 本仓库清理 |
| `.claude/commands/verify.md` 等 | 新增 | `agent-init` 生成 |
| `docs/presentations/apt-intro/source.md` | 修改（可选） | 六命令列表与幻灯片一致 |

**不改动：** `mcp-server/`、`arch-engine/`、历史 `docs/superpowers/specs/*`（除本 plan 引用的 verify spec）。

### 1.5 风险与未决项

| 风险 | 缓解 |
|------|------|
| MCP 寻址在本仓库不可用 | 实现不依赖 arch 索引；verify 行为以 spec §5 为准 |
| 用户 `~/.apt/templates` 未重装 | README 注明 `install.ps1` + 业务项目 `agent-init` |
| 本仓库 `.claude` 等仍含旧命令 | Task 8 显式删除 start-feature 产物并注入 verify |
| verify 与 finish 混淆 | verify 模板固定 Verify Report + 引导 finish |
| 宣讲 PPT 第 8 页命令名错误 | 可选 Task 9 更新 source + 重生成 slide 08 |

---

## Part 2 — 可执行任务清单

> 实现时由 `/implement-plan` 按序执行。

### Task 1: 新增 `templates/verify.md`

- [ ] 创建 `templates/verify.md`，frontmatter：`description: 实现后验收门禁：对照 plan、audit 只读、契约与可检索性检查、跑测试，输出 Verify Report`
- [ ] 正文按 spec §8：`§0` 上下文 → `§1` Plan 对照 → `§2` audit 只读 → `§3` 契约只读 → `§4` 可检索性抽检 → `§5` 测试/构建 → `§6` Verify Report（spec §5.3 格式）
- [ ] 明确 **禁止** `refresh_asset`、`register_contract`、`remove_asset`；用户要求「verify 并修复」时引导 `/finish-feature`
  - **Files:** `templates/verify.md`
  - **Verify:** 文件存在；含 `audit_arch_changes`、`query_contract`、`search_arch` 与 Verify Report 表格结构

### Task 2: 删除 start-feature 并更新分发脚本

- [ ] 删除 `templates/start-feature.md`
- [ ] `scripts/inject-platform-assets.cjs`：`PUBLIC_TEMPLATES` 移除 `start-feature.md`，新增 `verify.md`
  - **Files:** `templates/start-feature.md`（删）, `scripts/inject-platform-assets.cjs`
  - **Verify:** `node -e "const {PUBLIC_TEMPLATES}=require('./scripts/inject-platform-assets.cjs'); console.log([...PUBLIC_TEMPLATES])"` 输出含 `verify.md`、不含 `start-feature.md`，size 为 6

### Task 3: 更新闭环模板与 finish-feature

- [ ] `templates/_feature-closeout.md`：`## 2. 验证` → `## 2. 闭环后自检（简要）`；正文与 verify Phase 3–4 对齐（最小抽检，完整验收见 `/verify`）
- [ ] `templates/finish-feature.md`：description 改为 spec §6.1；首段指向 `/verify` FAIL 或 feature/implement-plan 漏跑；删除 `/start-feature` 引用
  - **Files:** `templates/_feature-closeout.md`, `templates/finish-feature.md`
  - **Verify:** `rg start-feature templates/finish-feature.md templates/_feature-closeout.md` 无匹配

### Task 4: 更新交叉引用模板

- [ ] `templates/feature.md`：§3 闭环摘要后增加「建议完成后运行 `/verify`」
- [ ] `templates/implement-plan.md`：§2 自动闭环后增加「建议 `/verify <plan路径>`」
- [ ] `templates/plan-from-spec.md`：§3 交付门禁增加「实现后使用 `/verify <plan路径>`」
  - **Files:** `templates/feature.md`, `templates/implement-plan.md`, `templates/plan-from-spec.md`
  - **Verify:** 三文件均含 `/verify` 字样

### Task 5: 更新 AGENTS 工作流片段

- [ ] `templates/_agents-md-snippet.md`：命令表删除 start-feature 行，新增 verify 行（`/verify` | `apt-verify` | 实现后验收）
- [ ] 推荐流程更新：有 spec 链末尾加 `→ /verify`；无 spec `/feature` 后加 `→ /verify`；FAIL 时 `/finish-feature`
  - **Files:** `templates/_agents-md-snippet.md`
  - **Verify:** 无 `start-feature`；含 `verify`

### Task 6: 更新 README 与最佳实践

- [ ] `README.md`：六命令表（verify 替换 start-feature）；工作流文字与 mermaid；快速开始删 start-feature；新增 vNext 迁移小段（spec §7.3）
- [ ] `docs/claude-code-best-practices.md`：场景表用 `/verify` 替代「只要计划」的 start-feature 行；补充 PR 前验收说明
  - **Files:** `README.md`, `docs/claude-code-best-practices.md`
  - **Verify:** `rg '/start-feature' README.md docs/claude-code-best-practices.md` 无运行时文档引用（迁移说明除外）

### Task 7: 测试与本地验证

- [ ] 确认 `scripts/inject-platform-assets.test.js` 仍通过（`PUBLIC_TEMPLATES` 数量 6；集成测试自动遍历 Set）
- [ ] 在 APT 仓库根运行 `node scripts/inject-platform-assets.test.js`（或项目既有 test 命令）
  - **Files:** `scripts/inject-platform-assets.test.js`
  - **Verify:** 测试全部 pass

### Task 8: 本仓库平台产物同步

- [ ] 删除 `.claude/commands/start-feature.md`、`.qoder/commands/start-feature.md`、`.agents/skills/apt-start-feature/`
- [ ] 从 `templates/` 运行 `agent-init` 或 `node scripts/inject-platform-assets.cjs <repo-root> <apt-home>` 生成 `verify` 与更新 `AGENTS.md`
- [ ] 同步 `.claude/commands/finish-feature.md`、`.qoder/commands/finish-feature.md`、`.agents/skills/apt-finish-feature/SKILL.md`（若 agent-init 从 ~/.apt 复制，需先 `install.ps1` 再 agent-init）
  - **Files:** `.claude/commands/`, `.qoder/commands/`, `.agents/skills/`, `AGENTS.md`
  - **Verify:** 存在 `verify.md` / `apt-verify`；不存在 `start-feature` / `apt-start-feature`；`AGENTS.md` 含 verify

### Task 9（可选）: 宣讲材料同步

- [ ] 更新 `docs/presentations/apt-intro/source.md` 六命令列表（verify 替换 start-feature）
- [ ] 更新 `outline.md` 第 8 页 KEY CONTENT，显式列出 6 个命令名；重生成 `08-slide-commands.png` 并 `bun merge-deck.mjs .`
  - **Files:** `docs/presentations/apt-intro/source.md`, `outline.md`, prompts, pptx
  - **Verify:** source 无 start-feature；幻灯片命令名与 README 一致

---

**实现后验收：** 使用 `/verify docs/apt/plans/2026-06-22-apt-verify-command-plan.md`（plan Status 改为 approved 后）对照本 Part 2 任务清单。
