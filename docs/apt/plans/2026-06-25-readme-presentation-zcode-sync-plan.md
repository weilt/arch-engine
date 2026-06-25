# README 与宣发 ZCode 同步 Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-06-25-readme-presentation-zcode-sync-design.md`
> **Command:** `/plan-from-spec`（brainstorming 收口后直接产出）
> **Status:** approved

**Goal:** 将 README 与 `docs/presentations/apt-intro/` 宣发文字同步至当前产品事实：五端平台（含 ZCode）、7 命令 / 15 MCP，并**如实**说明 ZCode「命令自动、MCP 需 Settings 配置」。

**Architecture:** 延续 2026-06-24「README-first 级联同步」；仅改文字，不重生成 pptx/pdf 图像。

---

## Part 1 — 技术方案

### 1.1 范围与约束

**范围内：**

- `README.md` — ZCode MCP 步骤修正、宣讲材料日期、可选故障排查
- `docs/presentations/README.md`
- `docs/presentations/apt-intro/source.md`
- `docs/presentations/apt-intro/speaker-notes.md`
- `docs/presentations/apt-intro/outline.md`
- `docs/presentations/apt-intro/prompts/09-slide-multiplatform.md`

**非目标：**

- baoyu-slide-deck、`merge-deck.mjs`、pptx/pdf 图像
- 代码 / `agent-init` 行为变更
- `docs/presentations/_template/`（除非发现与五平台矛盾的单句）

### 1.2 设计寻址

N/A — 纯文档任务。

### 1.3 依赖寻址表

| 依赖 | 来源 | 引用 | 摘要 |
|------|------|------|------|
| 上轮同步 spec | 文档 | `docs/superpowers/specs/2026-06-24-readme-presentation-sync-design.md` | 7 命令 / 15 MCP 基线 |
| ZCode 适配 spec | 文档 | `docs/superpowers/specs/2026-06-24-zcode-adaptation-design.md` | 平台路径与 agent-init 产出 |
| 当前 README 真源 | 文档 | `README.md` | 级联起点 |
| 狗食结论 | 会话 | ZCode 命令可见、MCP 需 Settings | MCP 表述修正依据 |

### 1.4 拟改动文件

| 文件 | 变更类型 |
|------|----------|
| `README.md` | 修改 |
| `docs/presentations/README.md` | 修改 |
| `docs/presentations/apt-intro/source.md` | 修改 |
| `docs/presentations/apt-intro/speaker-notes.md` | 修改 |
| `docs/presentations/apt-intro/outline.md` | 修改 |
| `docs/presentations/apt-intro/prompts/09-slide-multiplatform.md` | 修改 |

### 1.5 风险

| 风险 | 缓解 |
|------|------|
| Slide 9 图像仍四节点 | speaker-notes 口播说明「幻灯片下轮更新」 |
| 路径示例 Windows/macOS 混用 | README 给 `~/.apt` 与 `%USERPROFILE%\.apt` 各一例 |

---

## Part 2 — 可执行任务清单

> 文档任务，可单 Agent 串行完成；**不需** `/verify` 门禁（用户上轮文档同步惯例），完成后建议 grep 自检。

### Task 1: README ZCode 与宣讲材料段

- [ ] 更新 **ZCode 快速开始**（`README.md` ~L335 一带）
  - 步骤 1：`install.ps1` → 项目根 `agent-init`
  - 步骤 2：**Settings → MCP Servers** → Workspace 作用域 → **Import**（从 Cursor `.cursor/mcp.json` / Claude / Codex）**或** 手动添加 `agent-protocol-mcp`
  - 示例：`node` + `C:\Users\<you>\.apt\mcp-server\dist\index.js`，`APT_PROJECT_ROOT` = 项目根
  - 说明：`.zcode/commands` / `.zcode/skills` **自动**生效；`.zcode/mcp.json` 由 `agent-init` 写入但 **ZCode 可能不自动加载**，以 Settings 列表为准
  - 一步风险提示：**有命令无 MCP = 无法硬约束寻址**
  - **Files:** `README.md`
- [ ] 更新 **宣讲材料** 段（~L9–19）：文字同步日期 **2026-06-25**；注明含 ZCode 五端说明；pptx/pdf 图像仍为上一版
  - **Files:** `README.md`
- [ ] **Verify:** 通读 ZCode 段，确认与狗食流程一致

### Task 2: `docs/presentations/README.md`

- [ ] 听众指引：五端含 ZCode；MCP 在 ZCode 需 Settings 配置
- [ ] 图像滞后说明日期 → 2026-06-25
  - **Files:** `docs/presentations/README.md`
  - **Verify:** 与 README 宣讲段语义一致

### Task 3: `apt-intro/source.md`

- [ ] 首段平台列表加入 **ZCode**
- [ ] 「多平台一套 MCP」表增加行：`| ZCode | .zcode/commands/ + .zcode/skills/apt-*/ |`
- [ ] 补一句：ZCode MCP 在 Settings 中 Import 或手动配置（`agent-protocol-mcp`）
  - **Files:** `docs/presentations/apt-intro/source.md`
  - **Verify:** 7 命令 / 15 MCP 数字未被改坏

### Task 4: Slide 9 三文件（五平台）

- [ ] `outline.md` Slide 9：`四个平台` → `五个平台`；Body 增加 ZCode 一行（或 ZCode 与 Qoder/Codex 分组表述）
- [ ] `speaker-notes.md` Slide 9：口播五端；ZCode 强调命令自动 + MCP 需 Settings（~2 句）
- [ ] `prompts/09-slide-multiplatform.md`：Headline/Body 与 outline 对齐；VISUAL 注释改为五 spoke（供下轮图像重生成）
  - **Files:** `outline.md`, `speaker-notes.md`, `prompts/09-slide-multiplatform.md`
  - **Verify:** 三文件 Slide 9 平台数一致

### Task 5: 全库 grep 验收

- [ ] 在 `README.md` + `docs/presentations/apt-intro/` 运行 grep：
  - 不应出现：`四个平台`、`一套 MCP，四个平台`（产品事实语境）
  - 不应出现：宣发 `source.md` 首段仅四端且无 ZCode
  - 应出现：`ZCode`、`五个平台` 或等价五端表述
  - **Verify:** 手工对照 spec §6 验收表
  - **MCP:** N/A

### Task 6: （可选）README 故障排查小节

- [ ] 在 README 故障排查增加 **「ZCode：有 / 命令，MCP 列表为空」**
  - 检查 `~/.apt/mcp-server/dist/index.js` 存在
  - 项目根再跑 `agent-init`
  - ZCode Settings → Import 或粘贴 Full configuration JSON
  - **Files:** `README.md`
  - **Verify:** 3 步可独立执行

---

## 建议执行

```text
/implement-plan docs/apt/plans/2026-06-25-readme-presentation-zcode-sync-plan.md
```

文档任务完成后可直接 commit；无需 `/verify`（除非用户要求）。
