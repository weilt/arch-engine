# README 与宣发文字同步 Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-06-24-readme-presentation-sync-design.md`
> **Command:** `/plan-from-spec`
> **Status:** approved

**Goal:** 外科手术式修正 README 过时事实，并以 README 为真源同步 `apt-intro` 宣发文字；公开标注 pptx/pdf 图像滞后，不重跑 baoyu-slide-deck。

**Architecture:** 纯文档任务，README-first 级联更新 `source.md` → `speaker-notes` → `outline` / `prompts`；事实锚点来自 `scripts/inject-platform-assets.cjs`（7 命令）与 `mcp-server/src/index.ts`（15 MCP）；验收以 grep 一致性 + `/verify` 为主。

---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束

**范围内：**

- `README.md` 6 处外科手术（7 命令、15 MCP、`/verify` 设计阶段、宣讲滞后说明）
- `docs/presentations/` 文字真源同步与首次入库
- `apt-intro/source.md`、`speaker-notes.md`、`outline.md`、`prompts/04|06|07|08|12`
- `docs/presentations/README.md`、可选 `_template/README.md` 维护说明

**非目标：**

- 不重跑 baoyu-slide-deck；不更新幻灯片 PNG / pptx / pdf 图像
- README 深度重写；不改 `merge-deck.mjs` / `templates/apt-deck.md` 管线

### 1.2 设计寻址

**N/A** — spec 为文档同步，无前端 UI 实现任务。

### 1.3 依赖寻址表

| 依赖 | 来源 | 引用 | 摘要 |
|------|------|------|------|
| 7 个公开斜杠命令模板 | 源码 | `scripts/inject-platform-assets.cjs` `PUBLIC_TEMPLATES` | feature、plan-from-spec、implement-plan、verify、finish-feature、design-system、**design-page** |
| 15 个 MCP 工具注册 | 源码 | `mcp-server/src/index.ts` | 15× `server.tool(`；含 `register_ui_pattern`、`audit_design_changes` |
| `/verify` 设计 audit 阶段文案 | 源码 | `templates/verify.md` §2.5 | 含 UI 时 `query_design` + `audit_design_changes` 只读 |
| README MCP 工具表（真源） | 文档 | `README.md` §「MCP 工具（15）」 | 契约 3 + 架构 7 + 设计 5 |
| README 设计知识层小节 | 文档 | `README.md` §「设计知识层」 | design-sync、design-bindings、`/design-page` |
| 宣讲维护流程 | 文档 | `docs/presentations/_template/README.md` | baoyu-slide-deck 重生成入口 |
| inject 测试（7 模板） | 源码 | `scripts/inject-platform-assets.test.js` | 断言 `PUBLIC_TEMPLATES.size === 7` |

> `search_arch` 未命中 inject 脚本（fixture 索引不含 `scripts/`）；上表以仓库源码路径为实证。

### 1.4 拟改动模块与文件

| 文件/模块 | 变更类型 | 说明 |
|-----------|----------|------|
| `README.md` | 修改 | 6→7 命令、verify 设计阶段、宣讲滞后说明 |
| `docs/presentations/README.md` | 新增/修改 | 听众指引 + 图像滞后 |
| `docs/presentations/_template/README.md` | 修改 | 可选：文字先于图像更新惯例 |
| `docs/presentations/apt-intro/source.md` | 修改 | 7 命令、15 MCP、5 设计工具 |
| `docs/presentations/apt-intro/speaker-notes.md` | 修改 | Slide 4/7/8/12 口播 |
| `docs/presentations/apt-intro/outline.md` | 修改 | Slide 4/7/8/12 KEY CONTENT |
| `docs/presentations/apt-intro/prompts/04-*.md` | 修改 | 四层：7 命令、15 MCP |
| `docs/presentations/apt-intro/prompts/06-*.md` | 修改 | 工作流：verify 设计 audit（可选） |
| `docs/presentations/apt-intro/prompts/07-*.md` | 修改 | MCP 15 + 设计组补 2 工具 |
| `docs/presentations/apt-intro/prompts/08-*.md` | 修改 | 七个命令 + `/design-page` |
| `docs/presentations/apt-intro/prompts/12-*.md` | 修改 | design-bindings、audit_design_changes |
| `docs/presentations/apt-intro/*`（其余） | 新增入库 | analysis、package.json、merge-deck 等维护文件；pptx/pdf 保持现状 |

### 1.5 风险与未决项

| 风险 | 缓解 |
|------|------|
| 口播与新数字一致但 ppt 图像仍为旧版 | spec 定稿滞后说明文案；speaker-notes 开场可提示 |
| grep 误伤历史语境（如「从 13 扩展到 15」） | 禁止句只用于**当前版本总数**陈述 |
| `docs/presentations` 首次入库含大二进制 | 仅跟踪已有 pptx/pdf，不重生成 |

---

## Part 2 — 可执行任务清单

> 由 `/implement-plan` **严格串行**执行；文档任务可单 Agent 完成多 Task，仍按序验收。

### Task 1: README 外科手术

- [x] 按 spec §5.1 修改 `README.md`：四层表与斜杠命令标题「7 个」、`/verify` 含 UI 时设计 audit、`agent-init`「7 个」工作流命令
- [x] 在「宣讲材料」段加入 spec §5.5 图像滞后说明（链到 `_template/README.md`）
  - **Files:** `README.md`
  - **Verify:** `rg "6 个斜杠|斜杠命令（6）|6 个工作流" README.md` 无命中；`rg "7 个|15|design-page|图像仍为上一版" README.md` 有命中

### Task 2: 宣发索引与维护说明

- [x] 编写/更新 `docs/presentations/README.md`（听众路径 + 图像滞后说明）
- [x] 可选：`_template/README.md` 增加「文字可先于图像更新」一段
  - **Files:** `docs/presentations/README.md`, `docs/presentations/_template/README.md`
  - **Verify:** 文件存在且含「图像仍为上一版」或同等语义

### Task 3: apt-intro 叙事真源（source + speaker-notes + outline）

- [x] 更新 `source.md`：7 命令列表（含 `/design-page`）、15 MCP（设计 5 工具）、`design-bindings`、`/verify` 设计阶段、设计层 Phase 1–3 补齐摘要
- [x] 同步 `speaker-notes.md` Slide 4/7/8/12 数字与命令口播
- [x] 同步 `outline.md` 对应 slide KEY CONTENT
  - **Files:** `docs/presentations/apt-intro/source.md`, `speaker-notes.md`, `outline.md`
  - **Verify:** `rg "六个|13 个 MCP|13 个工具" docs/presentations/apt-intro/source.md docs/presentations/apt-intro/speaker-notes.md` 无命中；`rg "/design-page|15" docs/presentations/apt-intro/source.md` 有命中

### Task 4: apt-intro slide prompts

- [x] 更新 `prompts/04-slide-four-layers.md`：7 命令、15 MCP
- [x] 更新 `prompts/07-slide-mcp-tools.md`：15 MCP；设计组补 register/audit（摘要）
- [x] 更新 `prompts/08-slide-commands.md`：七个命令 + `/design-page`
- [x] 更新 `prompts/12-slide-design-layer.md`：bindings + audit（≤3 bullet）
- [x] 可选 `prompts/06-slide-workflow.md`：verify 设计 audit 一句
  - **Files:** `docs/presentations/apt-intro/prompts/04|06|07|08|12-*.md`
  - **Verify:** `rg "六个命令|13 个 MCP" docs/presentations/apt-intro/prompts` 无命中

### Task 5: 宣发目录入库与一致性验收

- [x] `git add` `docs/presentations/` 文字与维护文件（含现有 pptx/pdf，不重生成）
- [x] 全量 grep：`README.md` + `docs/presentations/apt-intro/` 禁止句清零（spec §6.1）
- [x] 人工对照：README 命令表 7 行 ↔ `source.md` ↔ speaker-notes Slide 8
  - **Files:** `docs/presentations/**`
  - **Verify:**
    ```bash
    rg "6 个斜杠|六个命令|13 个 MCP|13 个工具" README.md docs/presentations/apt-intro --glob "!*.pptx" --glob "!*.pdf"
    rg "7 个|15 个|/design-page|audit_design_changes" README.md docs/presentations/apt-intro --glob "!*.pptx" --glob "!*.pdf"
    node scripts/inject-platform-assets.test.js
    ```
  - **MCP:** N/A（文档任务）

---

## Part 3 — 实现后验收

```bash
/verify docs/apt/plans/2026-06-24-readme-presentation-sync-plan.md
```
