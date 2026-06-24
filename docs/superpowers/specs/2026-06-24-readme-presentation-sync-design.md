# README 与宣发文字真源同步设计

**日期:** 2026-06-24  
**状态:** 已批准（brainstorming）  
**关系:** 产品文档维护；不重生成幻灯片图像  
**触发:** Design Knowledge Layer 补齐验收 PASS 后，README 与 `apt-intro` 宣发文字仍停留在 2026-06-22 事实

---

## 1. 背景与目标

### 1.1 问题

仓库根 `README.md` 与 `docs/presentations/apt-intro/` 宣发文字真源存在事实漂移：

| 事实 | README（部分过时） | `apt-intro/source.md` |
|------|-------------------|------------------------|
| 斜杠命令数 | 表内 7 个，但多处仍写「6 个」 | 「6 个」「六个斜杠命令」 |
| MCP 工具数 | 15 | 13 |
| 设计 MCP | 5 个（含 register/audit） | 3 个 |
| `/design-page` | 命令表有 | 缺失 |
| `/verify` 设计阶段 | 模板有 §2.5 | 宣发未提 |

`docs/presentations/` 目录尚未入库；`apt-intro.pptx` / `apt-intro.pdf` 图像仍为 2026-06-22 生成版。

### 1.2 目标

1. **外科手术式**更新 `README.md`（不改章节结构）。
2. 以 README 为真源，同步宣发**文字**（`source.md`、`speaker-notes.md`、`outline.md`、相关 `prompts/`）。
3. 在对外文档**明确标注**：文字已更新，pptx/pdf 图像待下轮 baoyu-slide-deck 重生成。
4. 将 `docs/presentations/` 文字与维护文件纳入版本库（二进制 pptx/pdf 可保留现状）。

### 1.3 非目标

- 不重跑 **baoyu-slide-deck**（本轮不更新幻灯片 PNG / pptx / pdf 图像内容）。
- README 深度重写、新用户长篇指南。
- 修改 `merge-deck.mjs`、`templates/apt-deck.md` 生成管线逻辑（除非发现与 7 命令矛盾的单句）。

---

## 2. 用户决策（brainstorming 记录）

| 问题 | 选择 |
|------|------|
| 范围 | **C** — README 与宣发文字一体化，README 为真源 |
| 幻灯片图像 | **A** — 只更新文字，不重生成 pptx/pdf |
| README 力度 | **A** — 外科手术，结构不变 |
| 图像滞后说明 | **A** — README「宣讲材料」+ `docs/presentations/README.md` 公开标注 |

---

## 3. 方案

**采用方案 A（推荐）：README-first 级联同步**

```text
README.md
  → apt-intro/source.md
  → speaker-notes.md
  → outline.md + prompts（04/07/08/12，可选 06）
  → docs/presentations/README.md
  → git add（文字入库）
```

不采用「source.md 反写 README」或「只改 README 不动宣发」。

---

## 4. 必改事实清单

| 项 | 目标值 |
|----|--------|
| 斜杠命令 | **7**（含 `/design-page`） |
| MCP 工具 | **15** |
| 设计 MCP | `query_design`、`search_ui`、`report_design_gap`、`register_ui_pattern`、`audit_design_changes` |
| `/verify` | 含 UI 时 **设计 audit 只读阶段**（一句） |
| 设计层叙事 | Phase 1–3 已补齐（向量、incremental、bindings、HTML/Figma ingest 等可在 README 已有小节引用，宣发 slide 12 仅 3 bullet 摘要） |
| `design-bindings` | 与 README 设计层小节一致（CLI + 可选） |

---

## 5. 文件改动范围

### 5.1 README.md（6 处外科手术）

| 位置 | 改动 |
|------|------|
| 四层机制表（~L37） | 「6 个斜杠命令」→「**7 个**」 |
| 小节标题（~L48） | `### 斜杠命令（6）` → `（7）` |
| `/verify` 描述（命令表 + 能力表） | 补充「含 UI 时设计 audit（只读）」 |
| `agent-init` 说明（~L334） | 「6 个工作流」→「**7 个**工作流命令」 |
| 「宣讲材料」段（~L9–19） | 加图像滞后 ⚠️ 说明与文字同步日期 |

### 5.2 宣发文字

| 文件 | 改动要点 |
|------|----------|
| `docs/presentations/README.md` | 听众指引 + 图像滞后说明 |
| `apt-intro/source.md` | 7 命令、15 MCP、5 设计工具、`/design-page`、`design-bindings`、verify 设计阶段、设计层完成度 |
| `apt-intro/speaker-notes.md` | Slide 4/7/8/12 数字与命令列表 |
| `apt-intro/outline.md` | Slide 4/7/8/12 KEY CONTENT |
| `prompts/04-slide-four-layers.md` | 6→7，13→15 |
| `prompts/07-slide-mcp-tools.md` | 13→15；设计组补 register/audit（摘要级） |
| `prompts/08-slide-commands.md` | 六个→七个；补 `/design-page` |
| `prompts/12-slide-design-layer.md` | 补 bindings / audit（≤3 bullet） |
| `prompts/06-slide-workflow.md`（可选） | verify 含 UI 时设计 audit 一句 |

### 5.3 维护者文档（可选 1 段）

`docs/presentations/_template/README.md` — 增加「文字可先于图像更新」惯例。

### 5.4 入库

首次 `git add` `docs/presentations/` 下文字与维护文件；`apt-intro.pptx` / `apt-intro.pdf` 保持仓库内现有文件，不在本轮重生成。

### 5.5 图像滞后标注文案（定稿）

**README「宣讲材料」段：**

> 口播稿与 `source.md` 已与 README 同步（2026-06-24）。**pptx/pdf 幻灯片图像仍为上一版**，重生成步骤见 [宣讲维护手册](docs/presentations/_template/README.md)。

**`docs/presentations/README.md`：** 同上语义。

---

## 6. 验收标准

### 6.1 自动化（实现后）

在 `README.md` 与 `docs/presentations/apt-intro/` 内 grep，**不应再出现**（作为产品事实陈述）：

- `6 个斜杠`、`六个命令`、`13 个 MCP`、`13 个工具`（作为当前版本总数）

**应出现：**

- `7 个`、`15 个`、`/design-page`、`audit_design_changes`（宣发摘要级即可）

### 6.2 人工

- README 命令表 7 行 ↔ `source.md` 命令列表 ↔ `speaker-notes` Slide 8 一致。
- pptx/pdf 文件未经 baoyu 重跑（或仅 git 跟踪元数据变化）。

### 6.3 实现后 APT 验收

```text
/plan-from-spec docs/superpowers/specs/2026-06-24-readme-presentation-sync-design.md
→ /implement-plan
→ /verify
```

---

## 7. 实现路径与 Skills

| 阶段 | 工具 |
|------|------|
| Spec（本文） | brainstorming |
| Plan | `/plan-from-spec` 或 superpowers `writing-plans` |
| 实现 | `/implement-plan`（文档 Task，可单 Task） |
| 验收 | `/verify`（grep + 对照表） |
| **本轮不用** | baoyu-slide-deck |

---

## 8. Follow-up（下轮 spec）

- 跑 baoyu-slide-deck 全量或增量重生成 15 页 → 更新 pptx/pdf。
- 移除 README / `docs/presentations/README.md` 中的「图像滞后」提示。

---

## 9. 风险

| 风险 | 缓解 |
|------|------|
| 听众对照旧 ppt 与新口播不一致 | 公开标注 + 口播时说明「幻灯片下轮更新」 |
| `outline` 与 `prompts` 漏改 | plan Part 2 列文件清单 + verify grep |
| `docs/presentations` 首次入库体积大 | 仅提交必要文字；pptx/pdf 已存在则跟踪，不强制重生成 |
