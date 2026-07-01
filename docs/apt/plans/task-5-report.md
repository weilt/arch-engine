# Task 5 报告：文档与叙事修订

**Plan:** `docs/apt/plans/2026-07-03-apt-2.0.6-page-factory-plan.md` Task 5  
**Spec 依据:** §9 叙事修订 — 开发主导 handoff，PM 仅交 v0+文档

## 完成项

| 文件 | 变更 |
|------|------|
| `templates/design-page.md` | 附录 A 主路径改为 `apt-v0-handoff`；PM 仅交素材；开发写双文件；增 Phase A 门禁 `check-v0-freeze` |
| `templates/v0-visual-handoff-prompt.md` | 顶部声明主路径为开发 handoff、本模板为 Agent 内联字段规则；approved 由开发/TL 认定 |
| `templates/_agents-md-snippet.md` | 工作流表增行「v0 逐页 handoff（Phase A）→ apt-v0-handoff」 |
| `README.md` | 新增「两阶段页面工厂」小节：Phase A/B、`_pages.md`、`check-v0-freeze` 用法 |

## 验证

```bash
node scripts/inject-platform-assets.cjs <tmpdir> f:\software\claude_plugin
```

注入后 `AGENTS.md` 含 `apt-v0-handoff` 行：**PASS**

## 叙事对齐

- **主路径：** 开发 `apt-v0-handoff` + `_pages.md` + Phase A 门禁
- **降级：** 「PM 必审双文件」「Codex 视觉伴侣为主路径」→ 附录 A / v0-visual-handoff-prompt 仅作内联规则
- **保留：** `design-sync --adapter v0`、`query_design` 扩展不变

## 状态

**DONE**
