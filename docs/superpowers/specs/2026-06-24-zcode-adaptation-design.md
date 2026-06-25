# APT 多平台适配：ZCode

**日期:** 2026-06-24  
**状态:** 已批准（brainstorming 确认）  
**关系:** 扩展 APT 从 Claude Code / Cursor / Qoder / Codex 到智谱 **ZCode** ADE（`zcode.z.ai`）  
**方案:** 模板 SSOT + `agent-init` 时分平台转换（方案 1，对齐 Qoder/Codex 适配）

---

## 1. 目标

在**不改动** `mcp-server`、`arch-engine` 与 15 个 MCP 工具的前提下，使 APT 在 **ZCode** 上达到与其他平台同等的工作流能力：

| 能力 | ZCode |
|------|-------|
| MCP 工具（15 个） | ✅ Workspace `.zcode/mcp.json` |
| 工作流 `/` 命令（7 个） | ✅ `.zcode/commands/` |
| 工作流 `$` Skills（7 个） | ✅ `.zcode/skills/apt-*/` |
| 项目 MCP + `APT_PROJECT_ROOT` | ✅ `write-zcode-config.cjs` |
| `AGENTS.md` 路由片段 | ✅ 扩展现有幂等片段 |
| 全局 install 注册 MCP | ❌ 无 ZCode CLI，不做 |

**用户决策摘要（brainstorming）：**

- 交付深度 = **C（全套）**：MCP + 7 个斜杠命令 + 7 个 `$apt-*` Skill
- 全局 MCP = **A（仅项目级）**：`agent-init` 写 Workspace `.zcode/mcp.json`；`install` 不碰用户级配置

---

## 2. 非目标

- ZCode Plugin 打包分发
- 用户级 `~/.zcode/` MCP 写入或 `install` 全局注册
- 修改 `mcp-server` / `arch-engine` 核心逻辑或 MCP 工具签名
- MVP 仅文档、不做 `agent-init` 注入
- Qwen Code、QCode.cc 等其他 ADE
- 依赖 ZCode GUI「从 Claude/Codex 导入」作为唯一 MCP 配置路径（可作 README 补充说明，非主路径）

---

## 3. 架构

```text
templates/*.md  (SSOT)
       │
       ▼
inject-platform-assets.cjs
       ├── .claude/commands/          (已有)
       ├── .qoder/commands/           (已有)
       ├── .agents/skills/apt-*/       (已有，Codex)
       ├── .zcode/commands/            (新增，规则同 Qoder)
       └── .zcode/skills/apt-*/        (新增，规则同 Codex Skill)
       │
write-project-mcp-json.cjs  ──► .mcp.json + .cursor/mcp.json  (已有)
write-codex-config.cjs        ──► .codex/config.toml             (已有)
write-zcode-config.cjs        ──► .zcode/mcp.json                  (新增)

bin/agent-init.sh / agent-init.ps1  → 调用上述全部
install.ps1 / install.sh            → 部署 write-zcode-config.cjs 到 ~/.apt/scripts/
```

**不变层：** stdio MCP Server、`APT_PROJECT_ROOT` 解析、`.ai/` 数据目录、`start-init` / `design-sync` / `sync-changes` CLI。

---

## 4. 项目级产出物（`agent-init` 后）

```text
project/
├── .claude/commands/          # 7 个命令（不变）
├── .qoder/commands/           # 7 个命令（不变）
├── .agents/skills/            # 7 个 Codex Skills（不变）
├── .zcode/
│   ├── commands/              # 7 个命令（新增，可提交）
│   │   ├── feature.md
│   │   ├── plan-from-spec.md
│   │   ├── implement-plan.md
│   │   ├── verify.md
│   │   ├── finish-feature.md
│   │   ├── design-system.md
│   │   └── design-page.md
│   ├── skills/                # 7 个 ZCode Skills（新增，可提交）
│   │   ├── apt-feature/SKILL.md
│   │   └── ...
│   └── mcp.json               # Workspace MCP（新增，gitignore）
├── .mcp.json                  # Claude + Qoder（已有，gitignore）
├── .cursor/mcp.json           # Cursor（已有，gitignore）
├── .codex/config.toml         # Codex（已有，gitignore）
├── AGENTS.md                  # 含 ZCode 列的对照表
└── .ai/                       # 数据层（不变）
```

---

## 5. 模板转换规则

### 5.1 源与目标

| 源（`templates/`） | 注入目标 | 规则 |
|--------------------|----------|------|
| 7 个公开模板 | `.zcode/commands/` | **同 Qoder**：复制并删除 `model:` 行；保留 `description` frontmatter |
| 同上 | `.zcode/skills/apt-<slug>/SKILL.md` | **同 Codex**：见 §5.2 |
| `_feature-closeout.md` 等 `_` 前缀 | 不注入 | 仍为内部引用片段 |
| `_agents-md-snippet.md` | `AGENTS.md` | 见 §7 |

### 5.2 ZCode Skill 格式

与 Codex Skill 相同（ZCode 文档要求 `SKILL.md` + `name` / `description` frontmatter）：

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
| `feature.md` | `apt-feature` | `.zcode/skills/apt-feature/` |
| `plan-from-spec.md` | `apt-plan-from-spec` | `.zcode/skills/apt-plan-from-spec/` |
| `implement-plan.md` | `apt-implement-plan` | `.zcode/skills/apt-implement-plan/` |
| `verify.md` | `apt-verify` | `.zcode/skills/apt-verify/` |
| `finish-feature.md` | `apt-finish-feature` | `.zcode/skills/apt-finish-feature/` |
| `design-system.md` | `apt-design-system` | `.zcode/skills/apt-design-system/` |
| `design-page.md` | `apt-design-page` | `.zcode/skills/apt-design-page/` |

**ZCode 调用方式：**

- 斜杠命令：`/feature`、`/verify` 等（与 Claude / Cursor / Qoder 一致）
- Skill：`$apt-feature`、`$apt-verify` 等（与 Codex 一致）

### 5.3 实现脚本

- **`scripts/inject-platform-assets.cjs`**
  - 在现有 Qoder / Codex 输出基础上，增加 `.zcode/commands/` 与 `.zcode/skills/`
  - ZCode 命令复用 `buildQoderCommand()`；ZCode Skill 复用 `buildCodexSkill()`
- **`scripts/write-zcode-config.cjs`**（新增）
  - 输入：`<projectRoot>`、`<mcpEntry>`
  - 输出：`.zcode/mcp.json`，幂等 merge `agent-protocol-mcp` 条目
- 由 `bin/agent-init.sh` 与 `bin/agent-init.ps1` 在 `write-project-mcp-json` / `write-codex-config` 之后调用

---

## 6. MCP 配置

### 6.1 项目级（Workspace）

| 平台 | 文件 | 脚本 | 说明 |
|------|------|------|------|
| ZCode | `.zcode/mcp.json` | `write-zcode-config.cjs`（新增） | `mcpServers` JSON；`env.APT_PROJECT_ROOT` |

**JSON 结构：**

```json
{
  "mcpServers": {
    "agent-protocol-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["<absolute-path-to>/mcp-server/dist/index.js"],
      "env": {
        "APT_PROJECT_ROOT": "<absolute-project-root>"
      }
    }
  }
}
```

- `args[0]` 与 `APT_PROJECT_ROOT` 使用 `path.resolve` 绝对路径
- 合并逻辑与 `write-project-mcp-json.cjs` 一致：保留文件中其他 server，仅更新 `agent-protocol-mcp`
- `.zcode/mcp.json` 加入根目录 `.gitignore`（含本机绝对路径）

### 6.2 全局（`install.ps1` / `install.sh`）

**不扩展。** ZCode 无 `zcode mcp add` CLI；全局 MCP 由用户在 ZCode Settings 自行配置（本 spec 范围外）。

README 说明：在已 `agent-init` 的项目中打开 ZCode，于 Settings → MCP Servers 确认 Workspace 级 `agent-protocol-mcp` 已启用。

---

## 7. `AGENTS.md` 幂等注入

### 7.1 标记块

沿用 `<!-- apt-workflow:start -->` … `<!-- apt-workflow:end -->` 机制（与 Qoder/Codex spec 相同）。

### 7.2 片段更新

**命令 / Skill 对照表**扩展为：

| 场景 | Claude / Cursor / Qoder / **ZCode** | Codex |
|------|-------------------------------------|-------|
| 一站式功能开发 | `/feature` | `apt-feature`（`$apt-feature`） |
| Spec → 方案 | `/plan-from-spec` | `apt-plan-from-spec` |
| 按方案实现 | `/implement-plan` | `apt-implement-plan` |
| 实现后验收 | `/verify` | `apt-verify` |
| 闭环补救 | `/finish-feature` | `apt-finish-feature` |
| 设计系统同步 | `/design-system` | `apt-design-system` |
| 单页设计定稿 | `/design-page` | `apt-design-page` |

ZCode 同时支持 `/` 命令与 `$` Skill；Codex 列注明 `$` 前缀可选。

### 7.3 行为

与 Qoder/Codex spec §7 相同：无文件则创建；有标记则替换；无标记则追加；多次 `agent-init` 幂等。

---

## 8. 改动文件清单

| 文件 | 动作 |
|------|------|
| `scripts/inject-platform-assets.cjs` | 增加 `.zcode/commands` + `.zcode/skills` 输出 |
| `scripts/write-zcode-config.cjs` | 新增 |
| `scripts/inject-platform-assets.test.js` | 增加 ZCode 断言 |
| `scripts/write-zcode-config.test.js` | 新增 |
| `templates/_agents-md-snippet.md` | 增加 ZCode 列 |
| `bin/agent-init.sh` | 调用 `write-zcode-config`；成功文案含 ZCode |
| `bin/agent-init.ps1` | 同上 |
| `scripts/install.ps1` | 复制 `write-zcode-config.cjs` 到 `~/.apt/scripts/` |
| `scripts/install.sh` | 同上 |
| `.gitignore` | 增加 `.zcode/mcp.json` |
| `README.md` | ZCode 快速开始 + 平台对照表 |
| `AGENTS.md` | 由 `agent-init` 自动更新 |

**不改动：** `mcp-server/src/*`、`arch-engine/src/*`、7 个业务命令模板正文语义。

---

## 9. 测试

| 测试 | 断言 |
|------|------|
| `inject-platform-assets` ZCode commands | 7 文件；无 `model:` |
| `inject-platform-assets` ZCode skills | 7 目录；合法 `name` / `description` |
| `write-zcode-config` | 合法 JSON；`APT_PROJECT_ROOT` 为绝对路径；merge 幂等 |
| `write-project-mcp-json` | 回归：Claude/Cursor 行为不变 |
| `write-codex-config` | 回归：Codex 行为不变 |
| AGENTS.md 注入 | 含 ZCode 列；三次 `agent-init` 无重复标记块 |
| inject 回归 | `.qoder/commands`、`.agents/skills` 输出不变 |

---

## 10. Dogfood 验收（本仓库 `claude_plugin`）

实现完成后，在 APT 仓库根目录验证：

1. `agent-init` 生成 `.zcode/commands/`（7 文件）、`.zcode/skills/apt-*/`（7 目录）、`.zcode/mcp.json`
2. `AGENTS.md` 含 ZCode 列及 `<!-- apt-workflow:start -->` … `<!-- apt-workflow:end -->`
3. `README.md` 含 ZCode 快速开始
4. ZCode 打开本仓库，Settings → MCP 确认 `agent-protocol-mcp` 已连接（15 工具）
5. 分别用 `/feature` 与 `$apt-feature` 触发工作流（ smoke test）

---

## 11. 文档与使用流程

### ZCode 快速开始

```text
install.ps1（或 install.sh）→ agent-init（业务项目根）→ start-init
在 ZCode 打开该项目，Settings → MCP Servers 确认 agent-protocol-mcp 已连接
使用 /feature 或 $apt-feature
```

**说明：** ZCode 读取工作区根 `AGENTS.md` 与 `.zcode/commands/`；MCP 使用 Workspace 级 `.zcode/mcp.json`。一次 APT 流程可能连续调用多个 MCP 工具，建议在 ZCode 中开启 MCP 自动确认（若平台提供该选项）。

---

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| `.zcode/mcp.json` 路径或 schema 与文档不一致 | 实现前在 ZCode 实测；测试覆盖 JSON 结构；README 给出手动 Full configuration 粘贴示例 |
| `.zcode/commands` 与 `.zcode/skills` 漂移 | 单 SSOT + 转换器；禁止手改后当真相源 |
| Windows 路径反斜杠 | `path.resolve` + JSON 中统一为正斜杠或 Node 可解析格式（与现有 MCP 脚本一致） |
| ZCode 无全局 CLI | 明确非目标；README 仅说明 Workspace 配置 |
| `.zcode/mcp.json` vs `.zcode/commands` 提交策略 | commands/skills **提交**（无密钥）；mcp.json **不提交** |

---

## 13. 后续

- invoke `writing-plans` 生成 `docs/apt/plans/2026-06-24-zcode-adaptation-plan.md`
- 实现后在本仓库执行 dogfood：`agent-init` + ZCode 中 `/feature` 或 `$apt-feature` smoke test
