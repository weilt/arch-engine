# Claude Code 与多平台最佳实践（APT）

> 面向使用 **Agent-Protocol-Toolkit (APT)** 的业务项目团队。  
> 目标：让子代理**先查再写**、**做完必登记**、**缺依赖必阻塞**，避免编造接口与视觉。  
> 适用 IDE：**Claude Code**、**Cursor**、**Qoder**、**Codex**（配置方式不同，工作流相同）。

---

## 1. 核心原则

| 原则 | 含义 |
|------|------|
| **MCP 优先** | 查契约、架构、设计一律走 MCP；禁止代理直接打开 `.ai/` 下的文件「偷看」 |
| **有 spec 先 plan** | brainstorming 产出 spec 后：**`/plan-from-spec` → 审阅 → `/implement-plan`**；不用 superpowers `writing-plans` |
| **无 spec 再 feature** | 口头描述功能时用 **`/feature`**（寻址 → 计划 → 确认 → **子 Agent 编排实现** → 闭环） |
| **设计先于 UI** | 含前端 UI：先 `query_design` / `search_ui`，缺定义则 `report_design_gap` 并停 UI |
| **做完必闭环** | 实现后自动 `audit_arch_changes` → refresh/remove → `register_contract`；勿等 `/finish-feature` |
| **项目根即上下文** | 在**业务项目根**打开 IDE，确保 MCP 读到正确的 `.ai/`（`APT_PROJECT_ROOT`） |

---

## 2. 一次性准备（本机）

### 2.1 安装 APT

在 APT 仓库根目录执行（仅需一次；**仓库更新后需重跑**）：

```powershell
# Windows
.\scripts\install.ps1
```

```bash
# macOS / Linux
./scripts/install.sh
```

安装会：构建 `arch-engine` / `mcp-server`、部署到 `~/.apt/`、注册 MCP（Cursor、Claude Code、Qoder、Codex）、把 `agent-init` 等加入 PATH。

### 2.2 升级 APT（拉取新提交后）

```powershell
cd <apt-repo>
git pull
.\scripts\install.ps1          # 同步 ~/.apt/templates 与 MCP 二进制
cd <业务项目根>
agent-init                     # 刷新 6 个斜杠命令 + 项目 MCP
```

然后**新开** Claude Code / Cursor 会话。

### 2.3 Claude Code：验证 MCP（用户级）

Claude Code **不读取** `~/.claude/settings.json` 里的 `mcpServers`。

| 作用域 | 配置文件 |
|--------|----------|
| 用户级（所有项目） | `~/.claude.json` 顶层 `mcpServers` |
| 项目级 | 项目根 `.mcp.json`（`agent-init` 写入，含 `APT_PROJECT_ROOT`） |

```bash
claude mcp list
# 应看到 agent-protocol-mcp ✓ Connected
```

若缺失：

```powershell
claude mcp add agent-protocol-mcp -s user -- node $env:USERPROFILE\.apt\mcp-server\dist\index.js
```

或重跑 `.\scripts\merge-mcp-config.ps1`。

### 2.5 Qoder：验证 MCP

| 作用域 | 配置文件 |
|--------|----------|
| 用户级 | `~/.qoder/settings.json`（`qoder mcp add -s user`） |
| 项目级 | 项目根 `.mcp.json`（`agent-init` 写入，含 `APT_PROJECT_ROOT`） |

在 Qoder **智能体模式**下确认 `agent-protocol-mcp` 已连接。一次 `/feature` 可能连续调用多个 MCP 工具，建议在 MCP 确认弹窗勾选「后续自动运行」。

```powershell
qoder mcp add agent-protocol-mcp -s user -- node $env:USERPROFILE\.apt\mcp-server\dist\index.js
```

工作流斜杠命令位于 `.qoder/commands/`（与 `.claude/commands/` 内容等价，无 `model: sonnet`）。

### 2.6 Codex：验证 MCP

| 作用域 | 配置文件 |
|--------|----------|
| 全局 | `~/.codex/config.toml`（`codex mcp add`） |
| 项目级 | 项目根 `.codex/config.toml`（`agent-init` 写入，**gitignore**） |

```bash
codex mcp add agent-protocol-mcp -- node ~/.apt/mcp-server/dist/index.js
```

会话内 `/mcp` 应列出 `query_contract`、`search_arch` 等 13 个工具。工作流使用 `.agents/skills/apt-*/SKILL.md`（如 `apt-feature`）。

### 2.7 Cursor：验证 MCP

| 作用域 | 配置文件 |
|--------|----------|
| 用户级 | `~/.cursor/mcp.json`（`install.ps1` / `merge-mcp-config.ps1` 写入） |
| 项目级 | 项目根 `.cursor/mcp.json`（`agent-init` 写入，**必须含 `APT_PROJECT_ROOT`**） |

**推荐：** 在业务项目根打开 Cursor；依赖项目级 MCP 指向当前仓库的 `.ai/`。

**两个 `agent-protocol-mcp`？** 全局与项目各注册了一次。在本项目开发时**只启用项目级**（带 `APT_PROJECT_ROOT`），或从 `~/.cursor/mcp.json` 删除全局那条。

修改 MCP 配置后：**Reload MCP** 或重启 Cursor。

### 2.8 新开 IDE 会话

安装或升级后重启终端；首次使用建议**新开一个聊天会话**，确认工具列表含 13 个 APT 工具（`query_contract`、`search_arch`、`query_design` 等）。

---

## 3. 每个业务项目：Onboarding

在**业务项目根目录**执行：

```bash
agent-init          # 多平台命令/Skills + AGENTS.md + .ai/db.json + MCP 配置
# 配置 .ai/arch/arch.secrets.json 后：
start-init          # 首次全量扫描；大仓可用 start-init --full
```

`agent-init` 会：

- 分发 6 个工作流 → `.claude/commands/`、`.qoder/commands/`、`.agents/skills/apt-*/`
- 幂等写入 `AGENTS.md`（APT 路由片段）
- 创建 `.ai/db.json`
- 写入 `.mcp.json`、`.cursor/mcp.json`、`.codex/config.toml`（含 `APT_PROJECT_ROOT`）

**推荐**：用业务项目文件夹作为工作目录打开 IDE，而不是在 `~` 或 APT 工具仓里开发业务功能。

### 3.1 应提交 vs 不应提交

| 路径 | 建议 |
|------|------|
| `.claude/commands/`、`.qoder/commands/`、`.agents/skills/` | 可提交（无本机路径）；或每人 `agent-init` 生成 |
| `AGENTS.md` | 可提交（含 APT 路由片段） |
| `.ai/arch/arch.config.json` | 可提交（无密钥） |
| `.ai/arch/arch.secrets.json` | **勿提交**，加入 `.gitignore` |
| `.mcp.json` / `.cursor/mcp.json` / `.codex/config.toml` | **勿提交**（含本机路径）；每人 `agent-init` 生成 |

### 3.2 API Key

优先使用 `<项目>/.ai/arch/arch.secrets.json`，示例见 `docs/examples/arch.secrets.example.json`。

---

## 4. 推荐工作流

### 4.1 第三阶段：有 brainstorming spec（推荐）

```text
brainstorming → docs/superpowers/specs/*-design.md
       ↓
/plan-from-spec <spec路径>
       ↓
docs/apt/plans/*-plan.md（Part1 技术方案 + Part2 可执行任务，均含 MCP 引用）
       ↓ 审阅并说「确认」，plan 内 Status → approved
/implement-plan <plan路径>
```

- **不要**在 spec 通过后使用 superpowers `writing-plans`（不读契约/架构/设计索引）。
- `/plan-from-spec` **只规划不写代码**；寻址失败时 `report_missing` / `report_design_gap` 并停止。
- Plan 产出目录：`docs/apt/plans/`（与 `docs/superpowers/plans/` 历史文件分开）。

### 4.2 新项目 / 新模块（含 UI，无 spec）

```text
/design-system  →  baoyu 定稿  →  design-sync  →  start-init  →  /feature
```

1. **`/design-system`**：定 tokens、语义组件，执行 `design-sync --source designs/<path>`
2. **`start-init`**：扫描后端/前端架构，生成 `.ai/arch/`
3. **`/feature`**：描述功能，走完整寻址 → 计划 → 实现 → 闭环

### 4.3 日常功能开发（无 spec、口头描述）

```text
/feature <功能描述>
```

一条命令覆盖：依赖寻址（设计 + 契约 + 架构）→ 开发计划 → 等你确认 → 实现 → **自动闭环**。

### 4.4 实现后验收

```text
/verify [plan路径]
```

对照 plan Part 2、只读 `audit_arch_changes`、契约与可检索性检查、跑测试，输出 **Verify Report**。FAIL 时用 **`/finish-feature`** 修复后重新 verify。

### 4.5 闭环漏跑或 verify 未通过时

```text
/finish-feature
```

当 **`/verify` 报告 FAIL**，或代理实现完成但**未**执行 `audit_arch_changes` / `register_contract` 等时使用。

---

### 4.6 子 Agent 编排（实现阶段）

`/implement-plan` 与 `/feature` 的**实现阶段**由主 Agent 编排，**禁止 inline 写大段实现代码**：

1. 将工作拆为 **2–5 分钟** Task（plan Part 2 或 `/feature` §2.5）
2. **严格串行**：每 Task 派发全新 implementer 子 Agent → 测试绿 → Task 微闭环 → `git commit` → Task Reviewer Gate
3. 子 Agent：**只读 MCP** + Task 末 `register_contract` / `refresh_asset` / `remove_asset`；**禁止** `audit_arch_changes`
4. 全 Task 通过后：主 Agent **`audit_arch_changes`** 最终 sweep（`_feature-closeout`）
5. 无子 Agent 能力的环境：**停止**，不换 inline 实现

有 superpowers 时优先加载 **`subagent-driven-development`**；APT MCP 规则优先。运行时账本：`.apt/orchestration/progress.md`、`task-N-brief.md`、`task-N-report.md`。

Spec：[2026-06-22-apt-subagent-orchestration-design.md](superpowers/specs/2026-06-22-apt-subagent-orchestration-design.md)

---

## 5. 斜杠命令怎么选

| 场景 | 命令 |
|------|------|
| 已有 brainstorming spec | **`/plan-from-spec`** → **`/implement-plan`** → **`/verify`**（**第三阶段推荐**） |
| 常规功能开发（无 spec） | **`/feature`** → **`/verify`** |
| PR / 交付前验收 | **`/verify`** |
| 闭环漏跑或 verify FAIL | `/finish-feature` |
| 立项定视觉、同步设计库 | `/design-system` |

---

## 6. 代理寻址顺序（硬约束）

### 6.1 含 UI 的任务（§0.5）

对每个语义组件 / 页面，**禁止臆造色值、字号、圆角**：

1. `query_design`（`scope: "global"`）— tokens + `style.md`
2. `query_design`（`page: <slug>`）— 页面配方；无则 `search_ui`
3. `query_design`（`component: <id>`）— 逐个语义组件
4. 仍缺 → **`report_design_gap`**，**停止 UI 实现**（可先写接口与纯逻辑）

无 `.ai/design/profile.json` → 先 `design-sync` 或 `/design-system`。

### 6.2 每个技术依赖（§1）

**前一步命中即停止**：

1. `query_contract`（`name`）— 前端/跨端 TS 优先
2. 未命中 → `search_arch` → `query_arch`（精读 `path` / 锚点）
3. 换同义词再 `search_arch` 一次（最多 1 次）
4. 仍无 → **`report_missing`**，**停止开发**

说明：Java 工具类、Mapper、DO、Service 等通常走 **search_arch + query_arch**，不强制 TS 契约。

---

## 7. 实现完成：闭环清单

代理在交付前**必须**完成（`/feature`、`/implement-plan` 内置，勿等用户提醒）：

### 7.1 架构同步

1. `audit_arch_changes`（默认 `since: last-scan`）
2. `modified` → 每项 `refresh_asset`（**禁止**用旧 summary 调 `register_asset` 代替）
3. `new` / `unregistered` → `refresh_asset`
4. `deleted` → `remove_asset`
5. 四类皆空 → 报告写明「无架构资产变更」

CLI 等价：`sync-changes` / `sync-changes --dry-run`

### 7.2 TS 契约

若有对外 TS 类型：写入 `src/contracts/`（或项目约定目录），并 `register_contract`。

### 7.3 验证

- `register_contract` 后检查 `.ai/INDEX.md`
- `refresh_asset` 后用 `search_arch` 抽检，`query_arch` 精读
- 报告输出 **闭环摘要**：audit 统计、refresh 列表、新契约列表

---

## 8. MCP 工具速查

在 Claude Code 输入 `/mcp`；Cursor 在 MCP 面板查看是否已连接 `agent-protocol-mcp`。

| 阶段 | 工具 |
|------|------|
| 开发前 · 设计 | `query_design`, `search_ui`, `report_design_gap` |
| 开发前 · 契约/架构 | `query_contract`, `search_arch`, `query_arch`, `report_missing` |
| 开发后 · 登记 | `register_contract`, `register_asset` |
| 开发后 · 同步 | `audit_arch_changes`, `refresh_asset`, `remove_asset`, `sync_arch_changes` |

完整列表见 [README 命令与工具一览](../README.md#命令与工具一览)。

---

## 9. 终端 CLI 配合

在 IDE 终端或让代理执行（项目根）：

| 命令 | 何时用 |
|------|--------|
| `agent-init` | 新项目首次；APT 升级后刷新命令与 MCP |
| `start-init` | 架构索引首次 / 增量；大变更用 `--full` |
| `design-sync --source designs/<path>` | 设计定稿后 |
| `sync-changes` | 批量架构同步（与 MCP 闭环等价） |

---

## 10. 故障排查

| 现象 | 处理 |
|------|------|
| 无 `search_arch` 等 MCP 工具 | Claude：`claude mcp list`；Cursor：检查 MCP 面板；重跑 `merge-mcp-config.ps1`；**新开会话** |
| Cursor 两个 `agent-protocol-mcp` | 只保留项目级（含 `APT_PROJECT_ROOT`）；删全局重复项 |
| `MissingDesignProfileError` | 未 `design-sync`；或 `APT_PROJECT_ROOT` 未指向当前项目 |
| MCP 读到错误项目的 `.ai/` | 在项目根 `agent-init`；确认 `.cursor/mcp.json` / `.mcp.json` 含正确 `APT_PROJECT_ROOT` |
| 斜杠命令仍是旧版（无 `/plan-from-spec`） | 重跑 `install.ps1` + 项目根 `agent-init` |
| `audit_arch_changes` 失败 | 先 `start-init` 生成 `last-scan.json` |
| `start-init` 只生成 config 就退出 | 配置 `arch.secrets.json` 后重跑 |
| 代理直接读 `.ai/` 文件 | 强调「必须通过 MCP」；使用 `/feature` 或 `/plan-from-spec` 模板 |

---

## 11. 反模式（避免）

- 在 IDE 里开发业务功能，但工作目录不是业务项目根
- spec 通过后仍用 `writing-plans` 而非 `/plan-from-spec`
- 让代理「猜」接口类型或 UI 色值，跳过 MCP
- 功能做完只 commit，不 `audit_arch_changes` / `register_contract`
- 改完 Java/前端工具类后只 `register_asset`，不 `refresh_asset`
- 把 `arch.secrets.json` 提交到 Git
- 在 `~/.claude/settings.json` 配 MCP（Claude Code **无效**）

---

## 12. 最小自检（人工）

在新项目 onboarding 后，**新开 IDE 会话**依次验证：

```text
MCP 工具列表含 13 个 APT 工具
/design-system 或 design-sync 已完成（若做 UI）
search_arch 用户登录                     # 有命中（若已 start-init）
/plan-from-spec docs/superpowers/specs/…  # 应产出 docs/apt/plans/…-plan.md（有 spec 时）
/feature 做一个只读小改动               # 应产出计划并等待确认（无 spec 时）
```

---

## 相关文档

- [README.md](../README.md) — 安装、升级、配置、命令一览
- [设计知识层规格](superpowers/specs/2026-06-16-design-knowledge-layer-design.md)
- [架构同步规格](superpowers/specs/2026-06-16-arch-sync-changes-design.md)
- [Spec → Plan 第三阶段规格](superpowers/specs/2026-06-17-apt-plan-from-spec-design.md)
