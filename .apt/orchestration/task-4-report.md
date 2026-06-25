# Task 4 Report: /design-page 命令模板与分发

**Plan:** `docs/apt/plans/2026-06-24-design-knowledge-layer-completion-plan.md`  
**Status:** completed  
**Date:** 2026-06-24

## 交付物

| 文件 | 说明 |
|------|------|
| `templates/design-page.md` | 斜杠命令源模板（baoyu 单页 → `design-sync --pages-only` → 可选 `design-bindings --check`） |
| `.agents/skills/apt-design-page/SKILL.md` | Codex skill（无 `model` frontmatter） |
| `.claude/commands/design-page.md` | Claude/Cursor 分发产物 |
| `.qoder/commands/design-page.md` | Qoder 分发产物 |
| `scripts/inject-platform-assets.cjs` | `PUBLIC_TEMPLATES` 增至 7 项 |
| `scripts/inject-platform-assets.test.js` | 断言 7 个公开模板 |
| `templates/_agents-md-snippet.md` | 命令表新增 `/design-page` \| `apt-design-page` |
| `AGENTS.md` | 由 inject 同步更新 |
| `README.md` | 命令表与设计知识层小节补充 `/design-page` |

## 流程摘要

`/design-page` 面向**已有全局设计**的项目，协调单页原型定稿：

1. 确认页面 slug 与用途；无全局层时引导 `/design-system`
2. baoyu-design（或其它工具）产出单页 HTML/JSON 真源
3. `design-sync --source designs/<path> --pages-only`（支持 `--dry-run`、`--incremental`）
4. 可选 `design-bindings --check` / `--strict`（已配置组件库时）
5. MCP 验收：`query_design(page: …)`、`search_ui`

## 验证

```bash
node scripts/inject-platform-assets.test.js
```

结果：**8 tests, 0 fail**

```bash
node scripts/inject-platform-assets.cjs . .
```

结果：`.claude/commands`、`.qoder/commands`、`.agents/skills`、`AGENTS.md` 均已更新。

## 提交

```
feat(design): add /design-page command and platform distribution
```
