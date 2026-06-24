# Task 4 Report: /design-page 命令模板与分发

**Plan:** `docs/apt/plans/2026-06-24-design-knowledge-layer-completion-plan.md`  
**Status:** completed  
**Date:** 2026-06-24

## 交付物

| 文件 | 说明 |
|------|------|
| `templates/design-page.md` | 单页设计斜杠命令模板（baoyu 原型 → `design-sync --pages-only` → 可选 `design-bindings --check`） |
| `.agents/skills/apt-design-page/SKILL.md` | Codex skill（无 `model` frontmatter） |
| `.claude/commands/design-page.md` | Claude/Cursor 分发产物 |
| `.qoder/commands/design-page.md` | Qoder 分发产物（无 `model` 行） |
| `scripts/inject-platform-assets.cjs` | `PUBLIC_TEMPLATES` 增至 7 项，含 `design-page.md` |
| `scripts/inject-platform-assets.test.js` | 断言 7 个公开模板 |
| `templates/_agents-md-snippet.md` | 命令表新增 `/design-page` \| `apt-design-page` |
| `README.md` | 命令表与设计知识层小节补充 `/design-page` |
| `AGENTS.md` | 经 inject 同步 workflow 片段 |

## 流程摘要

`/design-page` 面向**已有全局设计**的项目，协调单页原型定稿：

1. 确认页面 slug 与用途
2. MCP 检查 global / page 现状
3. baoyu-design 产出单页 HTML/JSON 真源
4. `design-sync --source … --pages-only`（支持 `--dry-run` / `--incremental`）
5. 可选 `design-bindings --check`（`--strict`）
6. MCP 验收：`query_design(page)`、`search_ui`

无全局设计时引导用户先执行 `/design-system`。

## 验证

```bash
node scripts/inject-platform-assets.test.js
```

结果：**8 tests, 8 pass**（`PUBLIC_TEMPLATES.size === 7`，claude/qoder 各 7 个命令文件）。

```bash
node scripts/inject-platform-assets.cjs <projectRoot> <aptHome>
```

结果：成功生成 `.claude/commands/design-page.md`、`.qoder/commands/design-page.md`、`apt-design-page/SKILL.md`，并更新 `AGENTS.md`。

## Commit

```
feat(design): add /design-page command and platform distribution
```
