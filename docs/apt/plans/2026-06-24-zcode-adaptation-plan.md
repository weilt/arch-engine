# ZCode 平台适配 Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-06-24-zcode-adaptation-design.md`
> **Command:** `/plan-from-spec`
> **Status:** approved

**Goal:** 在不改动 `mcp-server` / `arch-engine` 核心的前提下，使 APT 在智谱 ZCode 上具备与其他平台同等能力：Workspace MCP（15 工具）、7 个 `/` 命令、7 个 `$apt-*` Skill，以及 `AGENTS.md` 路由片段。

**Architecture:** 延续 Qoder/Codex 的「模板 SSOT + `agent-init` 转换」模式：扩展 `inject-platform-assets.cjs` 输出 `.zcode/commands/` 与 `.zcode/skills/`；新增 `write-zcode-config.cjs` 写 `.zcode/mcp.json`；`install` 仅部署脚本，不注册 ZCode 全局 MCP。

---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束

**范围内：**

- `scripts/inject-platform-assets.cjs`：新增 ZCode commands + skills 输出
- `scripts/write-zcode-config.cjs`（新）：Workspace `.zcode/mcp.json`，幂等 merge `agent-protocol-mcp`
- `scripts/inject-platform-assets.test.js`、`scripts/write-zcode-config.test.js`（新）
- `templates/_agents-md-snippet.md`：对照表增加 ZCode 列
- `bin/agent-init.sh`、`bin/agent-init.ps1`：调用 `write-zcode-config`；成功文案含 ZCode
- `scripts/install.ps1`、`scripts/install.sh`：部署 `write-zcode-config.cjs` 到 `~/.apt/scripts/`
- `.gitignore`：`.zcode/mcp.json`
- `README.md`：ZCode 快速开始与平台表
- 本仓库 dogfood：`agent-init` 产出 `.zcode/**` 并更新 `AGENTS.md`

**非目标：**

- ZCode Plugin 打包、`~/.zcode/` 用户级 MCP 写入
- `install` 全局 ZCode MCP 注册（无 CLI）
- `mcp-server` / `arch-engine` 核心或 MCP 工具签名变更
- 7 个业务模板正文语义变更

### 1.2 设计寻址（无 UI 则写 N/A）

N/A — 本功能为安装脚本与多平台资产注入，不含前端 UI。

### 1.3 依赖寻址表

| 依赖 | 来源 | 引用（tsFilePath / sourcePath / path） | 摘要 |
|------|------|----------------------------------------|------|
| `injectPlatformAssets` | 脚本（spec §5.3） | `scripts/inject-platform-assets.cjs` | 从 `templates/` 分发到 `.claude`、`.qoder`、`.agents/skills`；需扩展 `.zcode` |
| `buildQoderCommand` | 脚本 | `scripts/inject-platform-assets.cjs` | 去 `model:` 行；ZCode commands 复用 |
| `buildCodexSkill` | 脚本 | `scripts/inject-platform-assets.cjs` | `name: apt-<slug>` frontmatter；ZCode skills 复用 |
| `injectAgentsMd` | 脚本 | `scripts/inject-platform-assets.cjs` | `<!-- apt-workflow:start/end -->` 幂等注入 |
| `PUBLIC_TEMPLATES` | 脚本 | `scripts/inject-platform-assets.cjs` | 7 个公开模板集合 |
| `mergeAgentProtocolEntry` | 脚本 | `scripts/write-project-mcp-json.cjs` | merge `mcpServers.agent-protocol-mcp` + `APT_PROJECT_ROOT`；`write-zcode-config` 应对齐 |
| `writeCodexConfig` | 脚本 | `scripts/write-codex-config.cjs` | Codex TOML 写入模式参考；ZCode 用 JSON |
| `write-project-mcp-json` 测试 | 脚本 | `scripts/write-project-mcp-json.test.js` | merge 保留其他 env、绝对路径断言 |
| `agent-init` | bin | `bin/agent-init.sh`、`bin/agent-init.ps1` | 串联 inject + write MCP 脚本 |
| `install` 部署 | 脚本 | `scripts/install.ps1`、`scripts/install.sh` | 复制 `scripts/*.cjs` 到 `~/.apt/scripts/` |
| `_agents-md-snippet` | 模板 | `templates/_agents-md-snippet.md` | AGENTS 路由片段 SSOT |
| ZCode 适配 spec | 文档 | `docs/superpowers/specs/2026-06-24-zcode-adaptation-design.md` | 已批准设计真源 |
| Qoder/Codex 适配 spec | 文档 | `docs/superpowers/specs/2026-06-18-qoder-codex-adaptation-design.md` | 同模式参考 |

**MCP 寻址说明：** `query_contract` / `search_arch` 未索引上述 Node 脚本（架构库当前为 Java 夹具）。实现 Task 以 **spec + 上表 sourcePath** 为准；实现后可选 `register_asset` 登记脚本模块。

### 1.4 拟改动模块与文件

| 文件/模块 | 变更类型 | 说明 |
|-----------|----------|------|
| `scripts/write-zcode-config.cjs` | 新增 | 写 `.zcode/mcp.json` |
| `scripts/write-zcode-config.test.js` | 新增 | JSON 结构、绝对路径、merge 幂等 |
| `scripts/inject-platform-assets.cjs` | 修改 | 增加 `.zcode/commands`、`.zcode/skills` |
| `scripts/inject-platform-assets.test.js` | 修改 | ZCode 7 文件 / 7 目录断言 |
| `templates/_agents-md-snippet.md` | 修改 | ZCode 列 |
| `bin/agent-init.sh` | 修改 | 调用 write-zcode-config |
| `bin/agent-init.ps1` | 修改 | 同上 |
| `scripts/install.ps1` | 修改 | 部署 write-zcode-config.cjs |
| `scripts/install.sh` | 修改 | 同上 |
| `.gitignore` | 修改 | `.zcode/mcp.json` |
| `README.md` | 修改 | ZCode 平台说明 |
| `AGENTS.md` | 生成 | agent-init 自动更新 |
| `.zcode/commands/*.md` | 生成 | 7 命令（可提交） |
| `.zcode/skills/apt-*/SKILL.md` | 生成 | 7 Skill（可提交） |

### 1.5 风险与未决项

| 风险 | 缓解 |
|------|------|
| `.zcode/mcp.json` schema 与 ZCode 实测不一致 | Task 1 测试锁定 `mcpServers` 结构；README 给 Full configuration 粘贴示例；dogfood 在 ZCode 打开项目验证 |
| merge 逻辑与 `write-project-mcp-json` 漂移 | 优先复用相同 merge 语义；测试覆盖保留第三方 server / env |
| Windows 路径 | `path.resolve`；与现有 MCP 脚本一致 |
| 架构 MCP 未索引 tooling | Part 1.3 已标注；实现不阻塞 |

---

## Part 2 — 可执行任务清单

> 由 `/implement-plan` **严格串行**执行；每 Task 通过 Review Gate 后继续。

### Task 1: 新增 `write-zcode-config.cjs` 与单元测试

- [ ] 阅读 `scripts/write-project-mcp-json.cjs` 的 `mergeAgentProtocolEntry` / `writeMcpFile` 语义
  - **MCP:** N/A（脚本未入 arch 索引；见 Part 1.3 `scripts/write-project-mcp-json.cjs`）
  - **Files:** `scripts/write-project-mcp-json.cjs`
- [ ] 新增 `scripts/write-zcode-config.cjs`：写入 `<projectRoot>/.zcode/mcp.json`
  - `mcpServers.agent-protocol-mcp`：`type: "stdio"`、`command: "node"`、`args: [entryAbs]`、`env.APT_PROJECT_ROOT`
  - 幂等 merge：保留文件中其他 server 与其他 env 键
  - 导出 `writeZcodeConfig(projectRoot, mcpEntry)` 供测试
  - **Files:** `scripts/write-zcode-config.cjs`
- [ ] 新增 `scripts/write-zcode-config.test.js`
  - 断言 JSON 合法、`APT_PROJECT_ROOT` / `args[0]` 为绝对路径
  - 断言 merge 保留既有 `FOO` 等 env
  - **Verify:** `node --test scripts/write-zcode-config.test.js`

### Task 2: 扩展 `inject-platform-assets` 输出 ZCode 资产

- [ ] 阅读 `injectPlatformAssets` 现有 Qoder / Codex 分支
  - **MCP:** N/A（见 Part 1.3 `scripts/inject-platform-assets.cjs`）
  - **Files:** `scripts/inject-platform-assets.cjs`
- [ ] 增加目录：`.zcode/commands/`（`buildQoderCommand`）、`.zcode/skills/apt-*/`（`buildCodexSkill`）
- [ ] 控制台输出 `OK` 日志与 `module.exports` 保持不变
  - **Files:** `scripts/inject-platform-assets.cjs`
- [ ] 更新 `scripts/inject-platform-assets.test.js`
  - integration：`.zcode/commands` 7 文件、无 `model:`
  - integration：`.zcode/skills/apt-feature/SKILL.md` 含 `name: apt-feature`
  - 回归：`.qoder/commands`、`.agents/skills` 计数仍为 7
  - **Verify:** `node --test scripts/inject-platform-assets.test.js`

### Task 3: 更新 `AGENTS.md` 片段模板（ZCode 列）

- [ ] 更新 `templates/_agents-md-snippet.md` 对照表
  - Claude / Cursor / Qoder / **ZCode** 列：7 个 `/` 命令
  - Codex 列：保留 `apt-*`，注明 ZCode 亦可用 `$apt-*`
  - **Files:** `templates/_agents-md-snippet.md`
  - **Verify:** 人工确认表格 7 行与 spec §7.2 一致

### Task 4: 串联 `agent-init` 调用 ZCode MCP 配置

- [ ] `bin/agent-init.sh`：在 `write-codex-config` 之后调用 `write-zcode-config.cjs`；成功文案含 ZCode
  - **Files:** `bin/agent-init.sh`
- [ ] `bin/agent-init.ps1`：同上
  - **Files:** `bin/agent-init.ps1`
- [ ] **Verify:** 在临时目录执行 `node $APT_HOME/scripts/inject-platform-assets.cjs` + `write-zcode-config.cjs`（或本地 `agent-init`）确认 `.zcode/mcp.json` 生成

### Task 5: `install` 部署新脚本

- [ ] `scripts/install.ps1`：复制 `write-zcode-config.cjs` 到 `~/.apt/scripts/`
  - **Files:** `scripts/install.ps1`
- [ ] `scripts/install.sh`：同上
  - **Files:** `scripts/install.sh`
- [ ] **Verify:** 确认 install 脚本列表含 `write-zcode-config.cjs`（无需实际跑全局 install）

### Task 6: `.gitignore` 与 README 文档

- [ ] `.gitignore` 增加 `.zcode/mcp.json`
  - **Files:** `.gitignore`
- [ ] `README.md` 更新
  - 首段平台列表加入 **ZCode**
  - 平台路径表：ZCode commands → `.zcode/commands/`；Skills → `.zcode/skills/apt-*/`
  - `agent-init` 说明含 `.zcode/mcp.json`
  - 新增 **ZCode 快速开始**（install → agent-init → start-init → Settings MCP 确认 → `/feature` 或 `$apt-feature`）
  - 明确：无 ZCode 全局 CLI，不扩展 `merge-mcp-config`
  - **Files:** `README.md`
  - **Verify:** README 中平台数与 7 命令 / 15 MCP 表述一致

### Task 7: 本仓库 dogfood 与全量脚本测试

- [ ] 在仓库根执行 `agent-init`（或等效 node 调用），生成/更新：
  - `.zcode/commands/`（7）
  - `.zcode/skills/apt-*/`（7）
  - `.zcode/mcp.json`（gitignore，本地存在即可）
  - `AGENTS.md` 含 ZCode 列
  - **Files:** `.zcode/commands/**`, `.zcode/skills/**`, `AGENTS.md`
- [ ] 运行脚本测试套件
  - **Verify:** `node --test scripts/inject-platform-assets.test.js scripts/write-zcode-config.test.js scripts/write-project-mcp-json.test.js scripts/write-codex-config.test.js`
- [ ] （可选，需本机 ZCode）打开本仓库，Settings → MCP 确认 `agent-protocol-mcp` 15 工具；`/feature` 与 `$apt-feature` smoke test
  - **Verify:** spec §10 dogfood 清单 1–3 满足；第 4–5 项标注为人工验收
