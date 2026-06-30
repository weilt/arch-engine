# Task 4 Report — query_ontology handler

**Status:** `DONE`

## 交付物
- `mcp-server/src/ontology-query.ts`（新建）：`handleQueryOntology(projectRoot, topic?)` 返回 `ProjectOntology | OntologyTopicResult | { error }`。
- `mcp-server/tests/ontology-query.test.ts`（新建）：5 个用例，全绿。
- commit `444b37b`（仅白名单两文件，`git add` 精确）。

## Verify（两步全绿）
1. `node node_modules/typescript/bin/tsc --noEmit` → exit 0。
2. `npx vitest run tests/ontology-query.test.ts` → 5 passed。

## 实现要点
- **入口守卫**：`arch-index.json` 不存在 → `{ error: "project not initialized; run start-init first" }`（唯一硬错）；外层 + 各子字段独立 try/catch，恒不抛错。
- **快照模式**：project（`loadOrInitConfig`，created→null）；status（`aggregateStatus` 只读，非 `handleQueryProjectStatus`，避免 write-back）；progress?（tasks.total>0 才输出，currentTask 读 progress.md 首个未完成 checkbox 行）；modules/packages（Task 3）；contracts（`readDb`→map，缺 db→空）；design?（tokens 目录有 json 或 profile.json 存在→检测；pages/components 取 *.json 去 .json 后缀）；approvalState?（复用 `st.specRisk`/`st.specApproval`，不重读 approvals/risk；两者皆无→字段缺省）。
- **焦点模式**：assets（`handleSearchArch` try/catch→空，无 vector db 不崩）；contracts（topic 小写子串匹配 name）；designPages?（设计层存在时 pages slug 子串匹配）；matchedIn（透明聚合命中层）。
- **类型**：`noImplicitAny` 下给 `let modules/packages/assets: T[]` 显式标注（ModuleOntology/PackageOntology/SearchHit）。

## 测试 fixture（真实最小集，无 mock）
写 `.ai/arch/backend/foo/utils.md`（1 个 `## Bar`）+ `.ai/db.json`（BarContract）+ `.ai/arch/arch-index.json`（backend/foo 节点）+ `.ai/arch/last-scan.json`（version 2，空 modules/packages）→ aggregateStatus 真实跑通不 blocked（audit 空四类）。覆盖：无 arch-index→error；最小快照含 modules(slug=foo, util=1)/contracts/status；焦点 bar 命中 contracts 且 matchedIn 含 contracts、assets 空；缺 db.json→contracts 空不崩；设计层检测（tokens/pages）。

## 待办（后续 Task）
- **不注册契约**：本 Task 未注册 `ProjectOntology`/`OntologyTopicResult`/`ProjectMeta` 到 index.ts（Task 8 统一注册 MCP 工具）。
- **无架构资产变更**：仅新增 mcp-server 两个文件，未动 `.ai/`。

## 给下一 Task 的 handoff
Task 5 负责 `query_ontology` 工具注册到 `index.ts`（tool 定义 + 路由到 `handleQueryOntology`）。类型 `ProjectOntology/OntologyTopicResult` 已在 `ontology/types.ts` 就绪（Task 1）。handler import 路径 `./ontology-query.js`。
