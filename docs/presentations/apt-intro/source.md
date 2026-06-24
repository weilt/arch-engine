---
presentation_mode: live-keynote
duration_minutes: 15-20
content_source: README.md
on_slide_max_bullets: 3
---

# Agent-Protocol-Toolkit (APT) 宣讲素材

> 让 Claude Code 多代理开发「有规矩」——契约查询、架构检索、依赖阻塞，从 Prompt 软约束变成 MCP 硬约束。

## 痛点

大模型在长任务开发中的三个典型问题：

1. **编造类型** — 忘记先查接口，直接臆造 TS 类型
2. **重复造轮子** — 不读项目架构，重复实现已有能力
3. **知识断层** — 功能做完不登记契约，下一个代理继续猜

对技术负责人而言，这意味着：接口漂移、架构文档过时、多代理协作不可审计。

## 转折：软约束不够

仅靠 Prompt 告诉模型「先查再写」不可靠。APT 把规则变成 **MCP 硬约束** — 代理必须调用工具，缺依赖必须阻塞。

## APT 是什么

APT（Agent-Protocol-Toolkit）是一套**全局安装、按项目激活**的开发工具集，面向 Claude Code、Cursor、Qoder、Codex 与 MCP。

四层机制：

| 层级 | 作用 |
|------|------|
| Custom Commands | 7 个斜杠命令，编排寻址→计划→**子 Agent 串行实现**→闭环 |
| MCP Server | 契约/架构/设计共 15 个工具，代理必须调用 |
| 架构引擎 | start-init 扫描代码，生成可检索架构文档 + 向量库 |
| 项目数据 | .ai/db.json、.ai/arch/、.ai/design/ 存项目知识 |

## 架构与数据流

开发者通过斜杠命令驱动子代理 → Custom Commands 调用 MCP Tools → agent-protocol-mcp 读写项目 .ai/ 数据 → arch-engine 负责扫描与索引。

不变层：MCP Server、arch-engine、15 个工具签名。项目层：.ai/ 契约库、架构文档、设计知识、向量索引。

## 推荐工作流

有 brainstorming spec 时：

```text
brainstorming → docs/superpowers/specs/*-design.md
       ↓
/plan-from-spec → docs/apt/plans/*-plan.md
       ↓ 用户确认
/implement-plan → 主 Agent 编排，每 Task 派子 Agent 串行 + 自动闭环
       ↓
/verify → 验收门禁（含 UI 时设计 audit 只读；FAIL → /finish-feature）
```

无 spec 时：口头描述 → `/feature` → `/verify`（FAIL → `/finish-feature`）。

## MCP 工具亮点（15 个，分三组）

**契约（3）**：query_contract 查类型、register_contract 登记、report_missing 阻塞

**架构（7）**：search_arch 语义搜索、query_arch 精读、audit/refresh/remove/sync 保持与源码一致

**设计（5）**：query_design、search_ui、report_design_gap、register_ui_pattern、audit_design_changes

## 七个斜杠命令

- `/plan-from-spec` — 从 spec 经 MCP 寻址生成实现方案
- `/implement-plan` — 按已批准方案**编排子 Agent 串行实现**并自动闭环
- `/feature` — 无 spec 时一站式开发
- `/verify` — 实现后验收门禁（对照 plan、只读 arch/设计 audit、测试）
- `/finish-feature` — verify 未通过或闭环漏跑补救
- `/design-system` — 立项定视觉，design-sync 沉淀
- `/design-page` — 单页原型定稿，design-sync --pages-only

## 多平台一套 MCP

| 平台 | 命令/Skills 路径 |
|------|------------------|
| Claude Code / Cursor | .claude/commands/ |
| Qoder | .qoder/commands/ |
| Codex | .agents/skills/apt-*/ |

全局安装一次，项目根 agent-init 激活。MCP 配置含 APT_PROJECT_ROOT。

## Before / After

| 无 APT | 有 APT |
|--------|--------|
| 代理编造接口类型 | query_contract 硬查，缺失则 report_missing 阻塞 |
| 架构知识散落 README | search_arch + query_arch 语义检索 + 向量库 |
| 做完不登记，下一代理重复踩坑 | register_contract + audit_arch_changes 自动闭环 |
| UI 随意发挥 | query_design + report_design_gap 设计硬约束 |

## 案例叙事：一个登录功能

1. 开发者描述「加 OAuth 登录」→ `/feature`
2. 子代理 query_contract(UserDTO) → 命中契约
3. search_arch「用户认证接口」→ query_arch 精读登录 API
4. 含 UI → query_design 全局 token + 登录页配方
5. 实现后 audit_arch_changes → refresh_asset → register_contract
6. 下一代理继续同一项目，知识已在 .ai/

## 设计知识层

框架无关：baoyu-design 定风格 → design-sync 沉淀 .ai/design/ → design-bindings 可选映射 → 开发先查设计再写 UI。Phase 1–3 已补齐（向量检索、incremental、HTML/Figma ingest、audit_design_changes）。与契约/架构形成三层硬约束。

## 开始用

安装与上手详见仓库 README — github.com/weilt/arch-engine

本幻灯片不展开安装步骤。

## 状态与社区

试用中，欢迎 Star、Issue、PR。
