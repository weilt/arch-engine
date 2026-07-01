# Task 6 Report — README + wave 1 dogfood

**Plan:** `docs/apt/plans/2026-07-04-java-api-path-rules-plan.md`  
**Status:** complete  
**Verify:** `cd arch-engine && npm test` — 324 passed; `tests/reindex/apis.test.ts` — PASS (2/2)

## Delivered

| File | Change |
|------|--------|
| `README.md` | §「Java Controller URL 前缀」：补充 `arch.config.java.controllerPathPrefixes` 示例、`start-init --reindex-apis`、`path-rules.json` 入 git、JAR 依赖兜底 |
| `README.md` | 目录结构增加 `path-rules.json` |
| `README.md` | FAQ：「改了 manual 规则要跑什么？」「规则在依赖 JAR 里怎么办？」；更新原 admin-api 缺失 FAQ |
| `arch-engine/tests/reindex/apis.test.ts` | 狗食断言：`api.md` 锚点、`path-rules.json` manual 规则、`arch-index` anchors 含 `/admin-api` |

## Wave 1 dogfood (spec §11.1)

Fixture `java-module` + manual `/admin-api` → `runReindexApis`：

1. 陈旧 `api.md`（无前缀）→ 重写为 `## GET /admin-api/demo/hello`
2. `path-rules.json`：`confidence: high`，`admin-api` 规则 `source: manual`
3. `arch-index.json` API 节点 keywords/anchors 含 `/admin-api`

## Notes

- 全量 `npm test` 有 `cli.test.ts` 触发的 `process.exit(1)` unhandled rejection（Task 5 遗留）；与本 Task 变更无关，reindex 集成测试独立通过。
