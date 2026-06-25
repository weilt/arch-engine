# APT 多平台适配：Qoder + Codex

**日期:** 2026-06-18  
**状态:** 已批准（brainstorming 确认）  
**关系:** 扩展 APT 从 Claude Code / Cursor 到 Qoder（IDE + CLI）与 OpenAI Codex CLI  
**方案:** 模板 SSOT + `agent-init` 时分平台转换（方案 1）

---

## 1. 目标

在**不改动** `mcp-server`、`arch-engine` 与 13 个 MCP 工具的前提下，使 APT 在 **Qoder** 与 **Codex** 上达到与 Claude Code / Cursor 同等的工作流能力：

| 能力 | Qoder | Codex |
|------|-------|-------|
| MCP 工具（13 个） | ✅ | ✅ |
| 工作流命令 / Skills（6 个） | ✅ `.qoder/commands/` | ✅ `.agents/skills/apt-*/` |
| 项目 MCP + `APT_PROJECT_ROOT` | ✅ 复用 `.mcp.json` | ✅ `.codex/config.toml` |
| `AGENTS.md` 路由片段 | ✅ | ✅ |
| 全局安装注册 | ✅ `qoder mcp add` | ✅ `codex mcp add` |

**用户决策摘要（brainstorming）：**

- QCode = **Qoder**（阿里 Agentic 编程平台）
- 交付深度 = **B（MCP + 命令/Skills 全套）**
- `AGENTS.md` = **agent-init 幂等追加路由片段**

---

## 2. 非目标

- Qwen Code、QCode.cc API 中转服务
- Qoder IDE 图形界面 MCP 的单独白屏配置流程（CLI + `.mcp.json` 足够）
- 修改 `mcp-server` / `arch-engine` 核心逻辑或 MCP 工具签名
- MVP 仅文档、不做 `agent-init` 注入
- 本阶段不做各平台独立的第二套模板目录（避免方案 2 的漂移）

---

## 3. 架构

```text
templates/*.md  (SSOT)
       │
       ▼
inject-platform-assets.cjs  ──► .claude/commands/     (Claude + Cursor，原样含 model: sonnet)
       │                    ──► .qoder/commands/       (去 model: 行)
       │                    ──► .agents/skills/apt-*/  (Codex Skills)
       │                    ──► AGENTS.md 片段（幂等）
       │
write-project-mcp-json.cjs  ──► .mcp.json + .cursor/mcp.json  (已有)
write-codex-config.cjs      ──► .codex/config.toml             (新增)

install.ps1 / install.sh
       └── merge-mcp-config.*  ──► Claude + Cursor + qoder + codex 全局 MCP
```

**不变层：** stdio MCP Server、`APT_PROJECT_ROOT` 解析、`.ai/` 数据目录、`start-init` / `design-sync` / `sync-changes` CLI。

---

## 4. 项目级产出物（`agent-init` 后）

```text
project/
├── .claude/commands/          # 6 个命令（不变）
├── .qoder/commands/           # 6 个命令（新增）
├── .agents/skills/            # 6 个 Codex Skills（新增）
│   ├── apt-feature/SKILL.md
│   ├── apt-plan-from-spec/SKILL.md
│   ├── apt-implement-plan/SKILL.md
│   ├── apt-start-feature/SKILL.md
│   ├── apt-finish-feature/SKILL.md
│   └── apt-design-system/SKILL.md
├── .mcp.json                  # Claude + Qoder 共用（已有）
├── .cursor/mcp.json           # Cursor（已有）
├── .codex/config.toml         # Codex MCP（新增，gitignore）
├── AGENTS.md                  # 含 <!-- apt-workflow --> 片段（新增或追加）
└── .ai/                       # 数据层（不变）
```

---

## 5. 模板转换规则

### 5.1 源与目标

| 源（`templates/`） | 注入目标 | 规则 |
|--------------------|----------|------|
| `feature.md` 等 6 个公开模板 | `.claude/commands/` | 原样复制（保留 `description`、`model: sonnet`） |
| 同上 | `.qoder/commands/` | 复制并删除 `model:` 行；保留 `description` frontmatter |
| 同上 | `.agents/skills/apt-<slug>/SKILL.md` | 见 §5.2 |
| `_feature-closeout.md` | 不注入任何平台 | 仍为 `/feature` 内部引用片段 |
| `_agents-md-snippet.md` | `AGENTS.md` | 见 §7 |

### 5.2 Codex Skill 格式

```yaml
---
name: apt-feature
description: <从原模板 frontmatter description 提取>
---
<正文：去掉 model: sonnet；MCP 工具名与步骤不变>
```

**映射表：**

| 模板文件 | Skill `name` | 目录 |
|----------|--------------|------|
| `feature.md` | `apt-feature` | `.agents/skills/apt-feature/` |
| `plan-from-spec.md` | `apt-plan-from-spec` | `.agents/skills/apt-plan-from-spec/` |
| `implement-plan.md` | `apt-implement-plan` | `.agents/skills/apt-implement-plan/` |
| `start-feature.md` | `apt-start-feature` | `.agents/skills/apt-start-feature/` |
| `finish-feature.md` | `apt-finish-feature` | `.agents/skills/apt-finish-feature/` |
| `design-system.md` | `apt-design-system` | `.agents/skills/apt-design-system/` |

**约束：** `name` 仅小写字母、数字、连字符，最长 64 字符（符合 Codex Skills 规范）。

### 5.3 实现脚本

- **`scripts/inject-platform-assets.cjs`**
  - 输入：`<projectRoot>`、`<aptHome>`（默认 `~/.apt`）
  - 读取 `templates/*.md`，执行上述转换并写入目标目录
  - 调用 AGENTS.md 注入逻辑（§7）
- 由 `bin/agent-init.sh` 与 `bin/agent-init.ps1` 在现有流程末尾调用（在 `write-project-mcp-json` 之后）

---

## 6. MCP 配置

### 6.1 项目级

| 平台 | 文件 | 脚本 | 说明 |
|------|------|------|------|
| Claude Code | `.mcp.json` | `write-project-mcp-json.cjs` | 已有；`type: stdio`，`env.APT_PROJECT_ROOT` |
| Cursor | `.cursor/mcp.json` | 同上 | 已有 |
| Qoder | `.mcp.json` | 同上 | **复用**；Qoder CLI 项目级读 `${project}/.mcp.json` |
| Codex | `.codex/config.toml` | `write-codex-config.cjs`（新增） | TOML 格式 |

**Codex TOML 结构：**

```toml
[mcp_servers.agent-protocol-mcp]
command = "node"
args = ["<absolute-path-to>/mcp-server/dist/index.js"]
enabled = true

[mcp_servers.agent-protocol-mcp.env]
APT_PROJECT_ROOT = "<absolute-project-root>"
```

- `args[0]` 与 `APT_PROJECT_ROOT` 使用 `path.resolve` 绝对路径
- `.codex/config.toml` 加入根目录 `.gitignore`（与 `.mcp.json` 同理，含本机路径）

### 6.2 全局（`install.ps1` / `install.sh`）

扩展 `scripts/merge-mcp-config.ps1` 与 `scripts/merge-mcp-config.cjs`（或并列 shell 逻辑）：

| 平台 | 命令 | CLI 缺失时 |
|------|------|------------|
| Claude Code | `claude mcp add agent-protocol-mcp -s user -- node <entry>` | 打印手动命令（已有） |
| Cursor | 写 `~/.cursor/mcp.json` | 已有 |
| Qoder | `qoder mcp add agent-protocol-mcp -s user -- node <entry>` | `Write-Warning` 手动说明 |
| Codex | `codex mcp add agent-protocol-mcp -- node <entry>` | 同上 |

全局注册**不**设置 `APT_PROJECT_ROOT`；项目级配置负责指向业务项目根。

---

## 7. `AGENTS.md` 幂等注入

### 7.1 标记块

```markdown
<!-- apt-workflow:start -->
## APT Workflow
...路由与 MCP 硬约束摘要...
<!-- apt-workflow:end -->
```

### 7.2 行为

1. 若项目根无 `AGENTS.md` → 从 `templates/_agents-md-snippet.md` 生成（含完整文件头 + 标记块）
2. 若已存在且含 `<!-- apt-workflow:start -->` → **替换** start/end 之间内容
3. 若已存在但无标记 → **追加**标记块到文件末尾
4. 多次 `agent-init` 结果一致（幂等）

### 7.3 片段必含内容

- 有 brainstorming spec 时：`/plan-from-spec` → `/implement-plan`；否则 `/feature`
- 依赖寻址顺序：`query_contract` → `search_arch` → `query_arch` → `report_missing`
- 含 UI：`query_design` / `search_ui` / `report_design_gap`
- 闭环：`audit_arch_changes`、`refresh_asset`、`register_contract`
- **平台对照：** Claude/Cursor/Qoder 用 `/feature` 等；Codex 用 `apt-feature` 等 Skill
- 禁止未经 MCP 直接读 `.ai/` 下索引文件

---

## 8. 改动文件清单

| 文件 | 动作 |
|------|------|
| `scripts/inject-platform-assets.cjs` | 新增 |
| `scripts/write-codex-config.cjs` | 新增 |
| `scripts/inject-platform-assets.test.js` | 新增 |
| `scripts/write-codex-config.test.js` | 新增 |
| `templates/_agents-md-snippet.md` | 新增 |
| `bin/agent-init.sh` | 调用 inject + write-codex-config |
| `bin/agent-init.ps1` | 同上 |
| `scripts/merge-mcp-config.ps1` | Qoder + Codex 全局注册 |
| `scripts/install.sh` | Qoder + Codex 全局注册 + 部署新脚本 |
| `scripts/install.ps1` | 复制新脚本到 `~/.apt/scripts/` |
| `.gitignore` | 增加 `.codex/config.toml` |
| `README.md` | Qoder / Codex 快速开始 + dogfood 说明 |
| `docs/claude-code-best-practices.md` | 可选：Qoder / Codex 小节 |

**不改动：** `mcp-server/src/*`、`arch-engine/src/*`、`templates` 中 6 个业务命令的正文语义（仅通过转换器分发）。

---

## 9. 测试

| 测试 | 断言 |
|------|------|
| `inject-platform-assets` | Qoder 命令无 `model:`；Skill 含合法 `name`/`description`；`_` 前缀模板不注入 |
| `write-codex-config` | 生成合法 TOML；`APT_PROJECT_ROOT` 为绝对路径 |
| `write-project-mcp-json` | 回归：现有 Claude/Cursor 行为不变 |
| AGENTS.md 注入 | 三次 `agent-init` 不产生重复标记块 |
| merge 降级 | `qoder`/`codex` CLI 不存在时不抛错，输出警告 |

---

## 10. Dogfood 验收（本仓库 `claude_plugin`）

实现完成后，在 APT 仓库根目录验证：

1. `agent-init` 生成 `.qoder/commands/`（6 文件）、`.agents/skills/apt-*/`（6 目录）、`.codex/config.toml`
2. `AGENTS.md` 含 `<!-- apt-workflow:start -->` … `<!-- apt-workflow:end -->`
3. `README.md` 含 Qoder / Codex 快速开始与 dogfood 步骤
4. `install.ps1` 后全局 MCP 在 Claude / Cursor / Qoder / Codex 四处可注册（CLI 存在时）
5. （可选）`start-init` 扫描本仓 + `register_contract` 登记至少 1 个对外 TS 类型

---

## 11. 文档与使用流程

### Qoder 快速开始

```text
install.ps1 → agent-init（业务项目根）→ start-init
在 Qoder 智能体模式确认 MCP agent-protocol-mcp 已连接
使用 /feature 或 /plan-from-spec
```

注意：Qoder 默认 MCP 调用需确认；APT 一次流程可能连续调用多个工具，建议开启「后续自动运行」。

### Codex 快速开始

```text
install.ps1 → agent-init → start-init
codex 会话内 /mcp 确认 agent-protocol-mcp
使用 apt-feature Skill 或 /apt-feature
```

---

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Qoder / Codex CLI 命令参数随版本变化 | install 脚本检测 CLI；失败时 README 给出手动命令 |
| Codex 不读 `.mcp.json` | 单独 `write-codex-config.cjs` |
| 模板与多平台副本漂移 | 单 SSOT + 转换器；禁止手改 `.qoder/commands` 入库（由 agent-init 生成，可提交或 gitignore——**建议提交**，无本机路径） |
| `.qoder/commands` 与 `.agents/skills` 是否提交 | **建议提交**（无密钥、无绝对路径）；`.codex/config.toml` **不提交** |

---

## 13. 后续（本 spec 之外）

- invoke `writing-plans` 生成 `docs/apt/plans/2026-06-18-qoder-codex-adaptation-plan.md`
- 实现后在本仓库执行完整 dogfood：`start-init` + 一次 `/feature` 闭环演练
