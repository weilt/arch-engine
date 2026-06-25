# README 与宣发文字同步（ZCode + MCP 说明修正）

**日期:** 2026-06-25  
**状态:** 已批准（brainstorming 收口；承接 `2026-06-24-readme-presentation-sync-design.md`）  
**关系:** 产品文档维护；不重生成幻灯片图像  
**触发:** ZCode 平台适配已落地；狗食发现命令自动生效但 MCP 需在 Settings 手动/Import 配置

---

## 1. 背景与问题

### 1.1 已完成

- ZCode 适配代码已合并：`agent-init` 注入 `.zcode/commands/`、`.zcode/skills/`、`.zcode/mcp.json`（gitignore）。
- `README.md` 已部分写入 ZCode（平台列表、路径表、快速开始一段）。

### 1.2 仍存在的漂移 / 误导

| 事实 | README | 宣发 `apt-intro/` |
|------|--------|-------------------|
| 支持平台 | 含 **ZCode** | `source.md` 仍写 Claude/Cursor/Qoder/Codex **四端** |
| Slide 9 | — | 「一套 MCP，**四个**平台」 |
| ZCode MCP 行为 | 写「Settings 确认连接」，未强调 **不自动读** 项目 `.zcode/mcp.json` | 无 ZCode 行 |
| 命令 vs MCP | 未说明「有命令无 MCP = 半套 APT」 | 无 |

**狗食结论（真源）：**

- `.zcode/commands/` → ZCode **自动**识别，`/feature` 等 7 命令可见。
- `.zcode/mcp.json` → `agent-init` 会写，但 ZCode **未必**自动载入 MCP 列表；需在 **Settings → MCP Servers** 中 **Import**（Cursor/Claude/Codex）或 **手动/Full configuration** 添加 `agent-protocol-mcp`（`~/.apt/mcp-server/dist/index.js` + `APT_PROJECT_ROOT`）。
- 无 MCP 时命令可触发，但无法 `query_contract` / `search_arch`，违反 `AGENTS.md` 硬约束。

### 1.3 目标

1. **外科手术式**修正 README 中 ZCode MCP 说明（不改整体章节结构）。
2. 以更新后的 README 为真源，同步宣发**文字**（`source.md`、`speaker-notes.md`、`outline.md`、`prompts/09` 等）。
3. 多平台叙事：**五端**（Claude Code、Cursor、Qoder、Codex、**ZCode**）。
4. 延续图像滞后策略：文字同步，**不重跑** baoyu-slide-deck / pptx / pdf。

### 1.4 非目标

- 不重生成 `apt-intro.pptx` / `apt-intro.pdf` 图像。
- 不修改 `write-zcode-config.cjs` 或 ZCode 产品本身。
- 不在本轮改 MCP 服务端逻辑。

---

## 2. 用户决策（收口）

| 问题 | 选择 |
|------|------|
| 范围 | README + 宣发文字一体化（延续 2026-06-24 方案 C） |
| 幻灯片图像 | 不重生成；更新滞后说明日期 |
| README 力度 | 外科手术 |
| ZCode MCP 表述 | **如实**：命令自动、MCP 需 Settings 配置（Import 或手动） |

---

## 3. 必改事实清单

| 项 | 目标值 |
|----|--------|
| 支持平台数（宣发 Slide 9） | **5** 端（含 ZCode） |
| 斜杠命令 | **7**（不变） |
| MCP 工具 | **15**（不变） |
| ZCode 命令路径 | `.zcode/commands/` + `.zcode/skills/apt-*/`（`$apt-*`） |
| ZCode MCP | Workspace Settings；`agent-init` 写 `.zcode/mcp.json` 作参考；**Import 或手动添加** `agent-protocol-mcp` |
| MCP 入口路径（文档示例） | `~/.apt/mcp-server/dist/index.js`（Windows：`%USERPROFILE%\.apt\...`） |
| 半套风险提示 | 有命令无 MCP → 无法硬约束寻址（一句） |

---

## 4. README 改动要点

| 位置 | 改动 |
|------|------|
| ZCode 快速开始（~L335） | 拆为：① `agent-init` ② **Settings → MCP** Import/手动 ③ 确认 15 工具；注明 `.zcode/mcp.json` 可能不被自动加载 |
| `agent-init` 说明 | 区分「注入命令/Skill」与「MCP 需在 ZCode UI 确认」 |
| 宣讲材料段（~L9–19） | 图像滞后日期 → **2026-06-25**；注明已含 ZCode 文字同步 |
| 可选：故障排查 | 新增一小节「ZCode 有命令无 MCP」3 步检查 |

---

## 5. 宣发改动要点

| 文件 | 改动 |
|------|------|
| `apt-intro/source.md` | 首段平台列表加 ZCode；多平台表加 ZCode 行；MCP 配置一句（Settings/Import） |
| `speaker-notes.md` | Slide 9：四平台→五平台；ZCode MCP 口播 2 句 |
| `outline.md` | Slide 9 KEY CONTENT：五个平台节点 |
| `prompts/09-slide-multiplatform.md` | Headline/Body：五平台；视觉说明五根 spoke（文字层，图像仍旧） |
| `docs/presentations/README.md` | 同步日期与 ZCode 说明 |

---

## 6. 验收标准

**Grep 不应再出现（作当前产品事实）：**

- `四个平台`、`一套 MCP，四个平台`（Slide 9 语境）
- `面向 Claude Code、Cursor、Qoder、Codex 与 MCP`（**无 ZCode** 的宣发首段）

**应出现：**

- README 与 `source.md` 均含 **ZCode**
- README ZCode 段含 **Import** 或 **Settings → MCP Servers** 配置步骤
- Slide 9 文字为 **五** 平台

**人工：** pptx/pdf 未重生成；口播 Slide 9 与 README 一致。

---

## 7. 风险

| 风险 | 缓解 |
|------|------|
| 幻灯片仍画四节点 | 口播按新稿；README 标注图像滞后 |
| ZCode 后续版本自动读 mcp.json | 文档写「若未出现请 Import」兼容新旧行为 |

---

## 8. Follow-up

- baoyu-slide-deck 重生成 Slide 9 等含平台数的页 → 更新 pptx/pdf。
- 若 ZCode 官方确认项目级 `mcp.json` 自动加载路径，再收窄 README 表述。
