# Slide Deck Outline

**Topic**: Agent-Protocol-Toolkit (APT) 对外宣讲
**Style**: blueprint
**Dimensions**: grid + cool + technical + balanced
**Audience**: general
**Language**: zh
**Slide Count**: 15 slides
**Generated**: 2026-06-22

---

<STYLE_INSTRUCTIONS>
Design Aesthetic: Clean technical blueprint style with engineering precision. Blueprint off-white background with subtle grid overlay. Analytical, professional, authoritative — suitable for architecture and system design presentations.

Background:
  Texture: Subtle grid overlay, light engineering paper feel
  Base Color: Blueprint Off-White (#FAF8F5)

Typography:
  Headlines: Bold clean geometric sans-serif with precise letterforms, technical authoritative presence
  Body: Elegant readable serif or clean sans for supporting text, professional editorial quality

Color Palette:
  Primary Text: Deep Slate (#334155) - headlines, body text
  Background: Blueprint Paper (#FAF8F5) - primary background
  Accent 1: Engineering Blue (#2563EB) - key elements, highlights
  Accent 2: Navy Blue (#1E3A5F) - supporting elements, diagrams
  Tertiary: Light Blue (#BFDBFE) - fills, backgrounds

Visual Elements:
  - Precise lines with consistent stroke weights
  - Technical schematics and clean vector graphics
  - Connection lines use straight lines or 90-degree angles only
  - Data flow diagrams with minimal charts
  - Isometric or orthographic projections for architecture slides

Density Guidelines:
  - Content per slide: minimal for live keynote — max 3 bullets, one main idea
  - Whitespace: generous margins, breathing room

Style Rules:
  Do: Maintain grid alignment, restrained color palette, clear visual hierarchy
  Don't: Hand-drawn shapes, photographic elements, slide numbers, footers, logos
</STYLE_INSTRUCTIONS>

---

## Slide 1 of 15

**Type**: Cover
**Filename**: 01-slide-cover.png

// NARRATIVE GOAL
Establish APT identity and core value proposition immediately.

// KEY CONTENT
Headline: Agent-Protocol-Toolkit
Sub-headline: 让多代理开发有规矩
Body: Prompt 软约束 → MCP 硬约束

// VISUAL
Blueprint-style cover with subtle grid background. Central technical schematic motif suggesting connected nodes/protocol. Engineering blue accent on title.

// LAYOUT
Layout: title-hero
Centered title hierarchy, minimal elements, strong focal point on headline.

---

## Slide 2 of 15

**Type**: Content
**Filename**: 02-slide-pain-points.png

// NARRATIVE GOAL
Create audience empathy — developers and leads recognize these failures.

// KEY CONTENT
Headline: 长任务开发的三个失控点
Body:
- 编造类型 — 不查接口就臆造
- 重复造轮子 — 不读架构
- 知识断层 — 做完不登记

// VISUAL
Three icon-style schematic blocks in a row, each with a warning amber accent dot. Blueprint grid background.

// LAYOUT
Layout: three-column
Equal columns, headline top, three pain points below.

---

## Slide 3 of 15

**Type**: Content
**Filename**: 03-slide-mcp-shift.png

// NARRATIVE GOAL
Pivot from problem to solution — the key insight.

// KEY CONTENT
Headline: 软约束救不了多代理
Sub-headline: APT 把规则写进 MCP
Body: 先查再写 · 缺依赖必阻塞

// VISUAL
Split diagram: left side faded "Prompt only" with dashed lines; right side solid "MCP hard constraint" with connected tool nodes in engineering blue.

// LAYOUT
Layout: split-comparison
Left-right contrast, arrow transition center.

---

## Slide 4 of 15

**Type**: Content
**Filename**: 04-slide-four-layers.png

// NARRATIVE GOAL
30-second positioning — what APT is.

// KEY CONTENT
Headline: 四层机制，一套工具集
Body:
- Custom Commands — 7 个斜杠命令
- MCP Server — 15 个硬约束工具
- 架构引擎 — 扫描 + 向量检索
- 项目数据 — .ai/ 知识库

// VISUAL
Stacked four-layer blueprint diagram, each layer a horizontal band with label. Clean technical illustration.

// LAYOUT
Layout: stacked-layers
Vertical stack, equal band heights.

---

## Slide 5 of 15

**Type**: Content
**Filename**: 05-slide-architecture.png

// NARRATIVE GOAL
Show system architecture for technical leads and architects.

// KEY CONTENT
Headline: 命令驱动，MCP 守门
Sub-headline: 不变层 + 项目层分离
Body: Commands → MCP → .ai/ 数据 → arch-engine

// VISUAL
Flow diagram: Developer → Commands → MCP Tools → .ai/ (db.json, arch/, design/) with arch-engine scanning codebase. Orthographic blueprint style.

// LAYOUT
Layout: flow-diagram
Left-to-right or top-down flow with labeled boxes and straight connectors.

---

## Slide 6 of 15

**Type**: Content
**Filename**: 06-slide-workflow.png

// NARRATIVE GOAL
Show the recommended development workflow without implementation detail.

// KEY CONTENT
Headline: 有 spec 走计划，无 spec 走 feature
Body:
- spec → /plan-from-spec → /implement-plan → /verify（含 UI 时设计 audit）
- 口头描述 → /feature → /verify
- FAIL → /finish-feature 补救

// VISUAL
Two parallel pipeline schematics with decision fork at top. Blueprint arrows between stages.

// LAYOUT
Layout: dual-pipeline
Two horizontal flows, clearly separated.

---

## Slide 7 of 15

**Type**: Content
**Filename**: 07-slide-mcp-tools.png

// NARRATIVE GOAL
Highlight MCP tools grouped by domain — not all 15 listed.

// KEY CONTENT
Headline: 15 个 MCP 工具，三组硬约束
Body:
- 契约 — 查、登、阻塞
- 架构 — 搜、读、同步
- 设计 — 查、搜、登记、audit

// VISUAL
Three-column schematic with icon blocks: Contract / Architecture / Design. Navy and blue accents.

// LAYOUT
Layout: three-pillars
Three equal pillars under headline.

---

## Slide 8 of 15

**Type**: Content
**Filename**: 08-slide-commands.png

// NARRATIVE GOAL
Introduce seven slash commands — emphasize plan-from-spec and feature.

// KEY CONTENT
Headline: 七个命令编排全流程
Body（七张卡片，必须逐字使用下列命令名）:
- /plan-from-spec — 从 spec 写方案
- /implement-plan — 按方案编码闭环
- /feature — 无 spec 一站式
- /verify — 实现后验收门禁
- /finish-feature — verify 失败补救
- /design-system — 设计系统同步
- /design-page — 单页原型定稿

// VISUAL
Six command cards in 2x3 grid, blueprint card style. Each card shows EXACT slash command name as primary label (no invented commands). Highlight /plan-from-spec and /implement-plan with blue border.

// LAYOUT
Layout: card-grid
2x3 grid of minimal command cards.

---

## Slide 9 of 15

**Type**: Content
**Filename**: 09-slide-multiplatform.png

// NARRATIVE GOAL
One MCP, multiple IDEs — reduce adoption friction.

// KEY CONTENT
Headline: 一套 MCP，五个平台
Body:
- Claude Code / Cursor
- Qoder / Codex / ZCode
- agent-init 项目激活

// VISUAL
Central MCP hub node with five platform nodes connected by straight lines. Blueprint hub-spoke diagram.

// LAYOUT
Layout: hub-spoke
Central hub, five spokes.

---

## Slide 10 of 15

**Type**: Content
**Filename**: 10-slide-before-after.png

// NARRATIVE GOAL
ROI narrative for tech leads — tangible before/after.

// KEY CONTENT
Headline: 有 APT 之后，团队得到什么
Body:
- 接口可查可阻塞，不再编造
- 架构可搜可同步，不再过时
- 做完必登记，代理可接力

// VISUAL
Before/After table schematic: left column muted gray "无 APT", right column blue "有 APT", three row pairs.

// LAYOUT
Layout: comparison-table
Two-column comparison, three rows.

---

## Slide 11 of 15

**Type**: Content
**Filename**: 11-slide-story.png

// NARRATIVE GOAL
Developer empathy — one feature end-to-end story.

// KEY CONTENT
Headline: 一个功能，从需求到闭环
Body:
- /feature → 寻址契约与架构
- 实现 → audit → refresh → register
- /verify 验收 → 下一代理接力

// VISUAL
Horizontal storyboard with 4-5 numbered blueprint panels showing workflow stages. Clean progression arrows.

// LAYOUT
Layout: storyboard
Horizontal sequence of panels.

---

## Slide 12 of 15

**Type**: Content
**Filename**: 12-slide-design-layer.png

// NARRATIVE GOAL
Extra value for teams with UI — design knowledge layer.

// KEY CONTENT
Headline: UI 也有硬约束
Sub-headline: 设计知识层 — 框架无关
Body: design-sync · design-bindings · audit_design_changes

// VISUAL
Layer diagram: Design layer on top of Architecture layer, tokens and component schematics. Light blue fill for design layer.

// LAYOUT
Layout: layered-stack
Two-layer stack with design emphasis on top.

---

## Slide 13 of 15

**Type**: Content
**Filename**: 13-slide-get-started.png

// NARRATIVE GOAL
Point to README — no install steps on slide.

// KEY CONTENT
Headline: 上手详见 README
Body:
- github.com/weilt/arch-engine
- 全局安装 · 项目 agent-init

// VISUAL
Clean minimal slide with large repo URL text and simple arrow pointing to "README". Blueprint style, lots of whitespace.

// LAYOUT
Layout: callout-minimal
Centered URL, minimal supporting text.

---

## Slide 14 of 15

**Type**: Content
**Filename**: 14-slide-community.png

// NARRATIVE GOAL
Community call — trial status, open source invitation.

// KEY CONTENT
Headline: 试用中，欢迎参与
Body:
- Star · Issue · PR
- 一起把多代理开发做「有规矩」

// VISUAL
Open community motif — connected nodes representing contributors. Warm but still blueprint palette. No logos.

// LAYOUT
Layout: community-nodes
Scattered node network, headline top.

---

## Slide 15 of 15

**Type**: Back Cover
**Filename**: 15-slide-back-cover.png

// NARRATIVE GOAL
Memorable close with clear next action.

// KEY CONTENT
Headline: 先查再写，做完必登记
Body: Agent-Protocol-Toolkit · Q&A
Sub-headline: github.com/weilt/arch-engine

// VISUAL
Clean back cover with core mantra as large text. Subtle blueprint grid. Engineering blue accent line.

// LAYOUT
Layout: closing-hero
Centered mantra, repo link below, Q&A implied.
