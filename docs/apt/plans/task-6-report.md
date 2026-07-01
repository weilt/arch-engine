# Task 6 报告：README + 波次 1 狗食验收

**Plan:** `docs/apt/plans/2026-07-04-java-api-path-rules-plan.md` Task 6  
**Spec 依据:** §13 文档与迁移；§11.1 波次 1 验收（manual + `--reindex-apis` → `api.md` 含前缀）

## 完成项

| 文件 | 变更 |
|------|------|
| `README.md` | §「Java Controller URL 前缀」：补充 `arch.config.java.controllerPathPrefixes` 示例、`start-init --reindex-apis`、`.ai/arch/path-rules.json` 入 git、JAR 依赖兜底（manual + OpenAPI） |
| `README.md` | FAQ：「改了 manual 规则要跑什么？」→ `--reindex-apis`；「规则在依赖 JAR 里怎么办？」→ manual + OpenAPI |
| `arch-engine/tests/reindex/apis.test.ts` | 狗食：复制 fixture 后删除 `WebMvcRegistrations`/`WebProperties` 源码（模拟 JAR 兜底）；`runReindexApis` 断言 `api.md` 含 `/admin-api`、`path-rules.json` confidence=medium、sources 仅 manual |

## 狗食场景（spec §11.1）

1. `java-module` fixture 去掉框架源码（规则仅在依赖 JAR）
2. `arch.config.json` 声明 manual `/admin-api` → `**.controller.admin.**`
3. 预置 stale `api.md`（无前缀）
4. `runReindexApis` → `api.md` 更新为 `GET /admin-api/demo/hello`；`path-rules.json` 写入 manual 规则

## 验证

```powershell
cd arch-engine; npm test
cd arch-engine; npm test -- tests/reindex/apis.test.ts
```

结果：**324/324 PASS**（reindex 狗食 2/2）

## 状态

**DONE**
