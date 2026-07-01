# Task 4 Report — rollup spec 与 plan/feature 模板

**Status:** DONE  
**BASE_SHA:** `62b0591`（Task 3）  
**Plan:** `docs/apt/plans/2026-07-03-apt-2.0.6-page-factory-plan.md`

## 交付物

| 文件 | 变更 |
|------|------|
| `templates/page-rollout-spec.md` | **新建** — Phase A 完成声明、页面清单、feature 域、跨页约束、logic 引用、B1/B2/B3 说明 |
| `templates/plan-from-spec.md` | **增补** §0 Phase A 门禁（`check-v0-freeze`）；Part 2 B1/B2/B3 单页 Task 示例 |
| `templates/feature.md` | **增补** §0 页面工厂与批量门禁、logic SSOT、禁止无 plan 批量 UI |

## 验证

```text
node scripts/inject-platform-assets.cjs tmp-inject-test .
```

- inject OK；`.claude`/`.qoder`/`.zcode` commands 与 `.agents`/`.zcode` skills 均含 `check-v0-freeze`、`B1/B2/B3`、`logic SSOT` 新段落
- 临时目录已删除

## 与 Spec §5 对照

- [x] rollup spec 骨架（§5.1）→ `page-rollout-spec.md`
- [x] plan-from-spec Phase A 门禁（§4.5 / §5.2）→ §0
- [x] 单页 B1/B2/B3 Task 模板（§5.3）→ Part 2 示例
- [x] feature 与 `/feature` 关系（§5.4）→ §0 批量门禁 + logic SSOT

## 未改动

- MCP 工具、inject `EXTRA_SKILLS`、AGENTS.md（非本 Task 白名单）
