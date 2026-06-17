# Claude Code 最佳实践（APT）

> 面向使用 **Agent-Protocol-Toolkit (APT)** 的业务项目团队。  
> 目标：让子代理**先查再写**、**做完必登记**、**缺依赖必阻塞**，避免编造接口与视觉。

---

## 1. 核心原则

| 原则 | 含义 |
|------|------|
| **MCP 优先** | 查契约、架构、设计一律走 MCP；禁止代理直接打开 `.ai/` 下的文件「偷看」 |
| **先寻址后编码** | `/feature` 或 `/start-feature` 完成依赖寻址与计划，用户确认后再写代码 |
| **设计先于 UI** | 含前端 UI 的任务：先 `query_design` / `search_ui`，缺定义则 `report_design_gap` 并停 UI |
| **做完必闭环** | 实现完成后自动 `audit_arch_changes` → refresh/remove → `register_contract`；不要等用户喊 `/finish-feature` |
| **项目根即上下文** | 在**业务项目根目录**启动 Claude Code，确保 MCP 读到正确的 `.ai/` |

---

## 2. 一次性准备（本机）

### 2.1 安装 APT

在 APT 仓库根目录执行（仅需一次）：

```powershell
# Windows
.\scripts\install.ps1
```

```bash
# macOS / Linux
./scripts/install.sh
```

安装会：构建 `arch-engine` / `mcp-server`、部署到 `~/.apt/`、注册 MCP、把 `agent-init` 等加入 PATH。

### 2.2 验证 Claude Code MCP（用户级）

Claude Code **不读取** `~/.claude/settings.json` 里的 `mcpServers`。

正确位置：`~/.claude.json` 顶层 `mcpServers`，或项目根 `.mcp.json`。

```bash
claude mcp list
# 应看到 agent-protocol-mcp ✓ Connected
```

若缺失，手动注册：

```bash
claude mcp add agent-protocol-mcp -s user -- node ~/.apt/mcp-server/dist/index.js
```

Windows：

```powershell
claude mcp add agent-protocol-mcp -s user -- node $env:USERPROFILE\.apt\mcp-server\dist\index.js
```

### 2.3 新开终端

安装后重启终端；首次使用 Claude Code 建议**新开一个会话**，再跑 `/mcp` 确认工具列表含 13 个 APT 工具。

---

## 3. 每个业务项目：Onboarding

在**业务项目根目录**执行：

```bash
agent-init          # 注入斜杠命令 + .ai/db.json + .mcp.json
# 配置 .ai/arch/arch.secrets.json 后：
start-init          # 首次全量扫描；大仓可用 start-init --full
```

`agent-init` 会：

- 复制 `/plan-from-spec`、`/implement-plan`、`/feature`、`/start-feature`、`/finish-feature`、`/design-system` → `.claude/commands/`
- 创建 `.ai/db.json`
- 写入项目根 `.mcp.json`（Claude Code 项目级 MCP，含 `APT_PROJECT_ROOT`）

**推荐**：用业务项目文件夹作为 Claude Code 工作目录打开，而不是在 `~` 或其它工具仓里开发业务功能。

### 3.1 应提交 vs 不应提交

| 路径 | 建议 |
|------|------|
| `.claude/commands/` | 可提交（团队统一流程）或每人 `agent-init` 生成 |
| `.ai/arch/arch.config.json` | 可提交（无密钥） |
| `.ai/arch/arch.secrets.json` | **勿提交**，加入 `.gitignore` |
| `.mcp.json` | **勿提交**（含本机 APT 路径）；每人 `agent-init` 生成 |

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

### 4.4 仅计划、暂不写代码（legacy）

```text
/start-feature <功能描述>
```

与 `/feature` 寻址与计划相同；有 spec 时请改用 **`/plan-from-spec`**。

### 4.5 漏跑闭环时

```text
/finish-feature
```

仅当代理实现完成但**未**执行 `audit_arch_changes` / `register_contract` 等时使用。

---

## 5. 斜杠命令怎么选

| 场景 | 命令 |
|------|------|
| 已有 brainstorming spec | **`/plan-from-spec`** → **`/implement-plan`**（**第三阶段推荐**） |
| 常规功能开发（无 spec） | **`/feature`** |
| 只要计划、口头描述 | `/start-feature`（有 spec 时用 `/plan-from-spec`） |
| 闭环漏跑补救 | `/finish-feature` |
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

代理在交付前**必须**完成（`/feature` 内置，勿等用户提醒）：

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

## 8. MCP 工具速查（Claude Code）

在会话中输入 `/mcp` 可查看是否已加载。

| 阶段 | 工具 |
|------|------|
| 开发前 · 设计 | `query_design`, `search_ui`, `report_design_gap` |
| 开发前 · 契约/架构 | `query_contract`, `search_arch`, `query_arch`, `report_missing` |
| 开发后 · 登记 | `register_contract`, `register_asset` |
| 开发后 · 同步 | `audit_arch_changes`, `refresh_asset`, `remove_asset`, `sync_arch_changes` |

完整列表见 [README 命令与工具一览](../README.md#命令与工具一览)。

---

## 9. 终端 CLI 配合

在 Claude Code 外挂终端或让代理执行（项目根）：

| 命令 | 何时用 |
|------|--------|
| `agent-init` | 新项目首次 |
| `start-init` | 架构索引首次 / 增量；大变更用 `--full` |
| `design-sync --source designs/<path>` | 设计定稿后 |
| `sync-changes` | 批量架构同步（与 MCP 闭环等价） |

---

## 10. 故障排查

| 现象 | 处理 |
|------|------|
| `/mcp` 无 `search_arch` 等 | 检查 `claude mcp list`；重跑 `merge-mcp-config.ps1`；**新开会话** |
| `MissingDesignProfileError` | 未 `design-sync`；或会话工作目录不是项目根 |
| MCP 读到错误项目的 `.ai/` | 在项目根 `agent-init`，确认 `.mcp.json` 含 `APT_PROJECT_ROOT`；在该目录启动 Claude Code |
| `audit_arch_changes` 失败 | 先 `start-init` 生成 `last-scan.json` |
| `start-init` 只生成 config 就退出 | 配置 `arch.secrets.json` 后重跑 |
| 代理直接读 `.ai/` 文件 | 在提示中强调「必须通过 MCP」；使用 `/feature` 模板约束 |

---

## 11. 反模式（避免）

- 在 Claude Code 里开发业务功能，但工作目录不是业务项目根
- 让代理「猜」接口类型或 UI 色值，跳过 MCP
- 功能做完只 commit，不 `audit_arch_changes` / `register_contract`
- 改完 Java/前端工具类后只 `register_asset`，不 `refresh_asset`
- 把 `arch.secrets.json` 提交到 Git
- 在 `~/.claude/settings.json` 配 MCP（**无效**）

---

## 12. 最小自检脚本（人工）

在新项目 onboarding 后，在 Claude Code 新会话中依次验证：

```text
/mcp                                    # 13 个 APT 工具
/design-system 或 design-sync 已完成
query_design scope global               # 有 tokens / style（若已同步设计）
search_arch 用户登录                     # 有命中（若已 start-init）
/feature 做一个只读的小改动             # 应产出计划并等待确认
```

---

## 相关文档

- [README.md](../README.md) — 安装、配置、命令一览
- [设计知识层规格](superpowers/specs/2026-06-16-design-knowledge-layer-design.md)
- [架构同步规格](superpowers/specs/2026-06-16-arch-sync-changes-design.md)
- [Spec → Plan 第三阶段规格](superpowers/specs/2026-06-17-apt-plan-from-spec-design.md)

---

*下一篇（计划中）：[Cursor 最佳实践](./cursor-best-practices.md)*
