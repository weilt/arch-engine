# Task 6 Report — /auto-brainstorm 模板改写 + Codex skill

**Status:** `DONE_WITH_CONCERNS`

## 交付物（仅白名单两文件）
- `templates/auto-brainstorm.md` — 改写：~30 行风险分级壳 → 完整 APT 原生 9 步引擎（161 行）。
- `.agents/skills/apt-auto-brainstorm/SKILL.md` — 新建：body 与模板**一字不差**（node 从模板单一来源派生，frontmatter 改 Codex skill 格式 name/description）。
- **Commit:** `2d321b9`（git add 仅此两文件，未 -A）。

## 9 步覆盖自检（第 2 步去除，其余全在）
1 探索上下文(可自主 query_ontology) / 3 澄清提问(可自主 query_ontology(topic)) / 4 提 2-3 方案 / 5 分节确认+Ontology 软提示 / 6 写 spec+「Ontology detection」章节 / **6.5 风险分级** / 7 spec 自检 / 8 用户审(仅 high) / 9 终端接 `/plan-from-spec`。另含 §0 自适应交互模式、§硬规则。

## 风险规则对齐 status/risk.ts（5 条触发 → high）
frontmatter `risk: high` ｜ `mcp-server`/新增 MCP server/`新 MCP` ｜ `arch-engine`/架构管线(`arch pipeline`/`arch 管线`) ｜ `breaking API`/`新对外契约`/`破坏性 API` ｜ 拟改动 > 8 文件。与 risk.ts 的 HIGH_RISK_KEYWORDS + classifySpecRisk 完全一致。

## 自适应模式
默认交互（.apt/goal.md 不存在，high 停等人批）｜全自动（.apt/goal.md 存在，AI 兼扮两角，high 仍设 spec_pending_approval 但不阻塞循环）。

## ⚠️ Concern：Verify-1 superpowers grep 有 2 命中（非真依赖，已定位）
brief 硬规则原文：「不引用 superpowers：body 内不得出现对 **superpowers skill 的依赖或调用**」。我保留 spec 存储路径 `docs/superpowers/specs/...`（§6），它含字面 superpowers，故 Select-String -Pattern superpowers 命中 2 次（两文件各 1，均在该路径处）。

**保留理由（实证）：** 该目录是项目真实在用的 spec 存储约定——内含 18 份现存 design spec（含今日 2026-06-29-apt-brainstorm-ontology-design.md），且 /plan-from-spec 从此目录读（其 SKILL.md 示例路径即此）；docs/apt/specs 不存在。单方面改一个模板的输出路径会把新 spec 与 18 份既有 spec 拆到两处、且 plan-from-spec 文档仍指向旧目录，造成管线断裂（真实缺陷）。而存储路径是文件系统位置，非对 skill 的运行时依赖或调用，符合硬规则实质条款。

**真意图已满足：** 精确意图 grep（superpowers: / writing-plans / superpowers skill / brainstorming skill）= **0 命中**；9 步逻辑全内联，终端是 /plan-from-spec，五平台行为一致。

**建议（超出本 Task 白名单）：** 若要 grep 字面归零，正确做法是全仓库把 spec 目录改名 docs/superpowers/specs/ → docs/apt/specs/（含迁移 18 份 spec、同步 plan-from-spec 等多文件），不应在 Task 6 单模板内擅改。

## 微闭环
纯 markdown，无代码 / 无对外 TS 契约 / 无架构资产变更；未跑 audit_arch_changes（按禁令）。

## 回报（主 Agent）
Task 6 DONE_WITH_CONCERNS。两白名单文件已写并 commit(2d321b9)：9 步引擎完整(除 Visual Companion)、风险规则对齐 risk.ts、自适应模式/硬规则齐备、ontology 注入由 AI 自主、终端 /plan-from-spec、Codex skill body 与模板一字不差。唯一 Concern：verify superpowers grep 命中 2 次，均为既有 spec 存储目录 docs/superpowers/specs/(18 份在用、plan-from-spec 读此处)的路径字面，非 skill 依赖；真意图 grep=0。修法是全仓目录改名(超白名单)，故未擅改。
