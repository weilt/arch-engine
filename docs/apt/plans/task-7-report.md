# Task 7 Report — 回归 + inject 产物提交

**日期**: 2026-07-01  
**范围**: APT 2.0.6 page-factory inject 输出

## 回归结果

| 套件 | 命令 | 结果 |
|------|------|------|
| arch-engine | `npm test` | **PASS** — 63 files, 305 tests |
| mcp-server | `npm test` | **PASS** — 21 files, 127 tests |
| scripts | `node --test scripts/inject-platform-assets.test.js scripts/check-v0-freeze.test.js` | **PASS** — 14 tests |

无 flaky 重试。

## inject

```bash
node scripts/inject-platform-assets.cjs f:\software\claude_plugin f:\software\claude_plugin
```

输出已写入 `.agents/`、`.zcode/`、`.claude/`、`.qoder/`、`AGENTS.md`。

## 提交范围（page-factory 2.0.6）

- `.agents/skills/apt-v0-handoff/`（新增）
- `.zcode/skills/apt-v0-handoff/`（新增）
- Task 4/5 模板 inject：`plan-from-spec`、`feature`、`design-page`、`verify`（commands + skills，四平台）
- `AGENTS.md`：`apt-v0-handoff` 行 + verify 闭环第 5 步
- `docs/apt/plans/2026-07-03-apt-2.0.6-page-factory-plan.md`

**未纳入本次提交**（与 2.0.6 page-factory 无关或另批）：

- `.apt/`、`.apt/verify/`
- `apt-goal`、`apt-current-status`、`auto-brainstorm` 相关 inject 产物
- `apt-auto-brainstorm` 仅空白符 normalize

## 禁止项

- 未调用 `audit_arch_changes`
