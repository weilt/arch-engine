# APT Entity & Flow Ontology Layer Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-06-30-apt-entity-flow-design.md`
> **Command:** `/plan-from-spec`
> **Status:** draft

**Goal:** 为项目本体图增加实体层（entity）与数据流层（flow），使 AI 能查询实体关系与数据流向，并支持 query_impact 变更影响分析。

**Architecture:** 三层设计—扫描层（4 个正则 scanner）→图层（types.ts 新类型 + writer 持久化 JSON/MD）→查询层（query_ontology relations + query_impact 第 18 工具）。全程确定性正则推导，不经过 LLM/embedding。

---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束

- Entity 层：JPA 注解 + MyBatis XML mapper + SQL DDL 三源提取。
- Flow 层：正则跨层类型名交叉匹配（批量化，与 entity 数解耦）。
- 查询：query_ontology + relations；query_impact 第 18 个 MCP 工具。
- 非目标：无 tree-sitter、无图数据库、无可视化、无后端多语言、不重扫前端。

### 1.2 设计寻址（无 UI）

N/A — 本功能纯后端 + MCP 工具，无前端 UI。

### 1.3 依赖寻址表

| 依赖 | 来源 | 引用 | 摘要 |
|------|------|--------|------|
| ApiClientContract | contract | arch-engine/src/types.ts | 前端 API 客户端契约，endpoints[]含 method+path。flow 前端链复用 |
| RouteEntry | contract | arch-engine/src/types.ts | 前端路由条目（path/name/component）。flow 前端链复用 |
| StoreContract | contract | arch-engine/src/types.ts | 前端 store 契约（state/getters/actions）。flow 前端链复用 |
| ProjectOntology | contract | mcp-server/src/ontology/types.ts | query_ontology 返回类型，本版增加 relations? 字段 |
| DocumentModel | types.ts | arch-engine/src/types.ts | 文档模型，本版增加 entities?/flows? 字段 |
| handleQueryOntology | search_arch | mcp-server/src/ontology-query.ts | query_ontology handler，本版增加 relations 补充 |
| ArchNodeKind | types.ts | arch-engine/src/types.ts | 本版增加 entity-doc/flow-doc |

注：EntityGraph/FlowGraph/EntityDef 等为本版新建类型（非复用依赖），无需寻址。

### 1.4 拟改动模块与文件

| 文件/模块 | 变更类型 | 说明 |
|-----------|----------|------|
| arch-engine/src/types.ts | 修改 | 新增 EntityGraph/FlowGraph/EntityDef/EntityRelation/FlowNode/FlowEdge 类型 + DocumentModel.entities?/flows? + ArchNodeKind 扩展 |
| arch-engine/src/scanners/entity-jpa.ts | 新增 | JPA @Entity/@Table/@Column/@OneToMany 扫描 |
| arch-engine/src/scanners/entity-mybatis.ts | 新增 | MyBatis *Mapper.xml resultMap/association/collection 扫描 |
| arch-engine/src/scanners/entity-sql.ts | 新增 | SQL CREATE TABLE/FOREIGN KEY 扫描 |
| arch-engine/src/scanners/entity-merge.ts | 新增 | 三源合并去重（moduleSlug:table 复合键） |
| arch-engine/src/scanners/flow-scanner.ts | 新增 | deriveFlowGraph 批量化跨层推导 + confidence |
| arch-engine/src/writer/entity-md.ts | 新增 | writeEntityDocs → entities.md + entities.json（原子写） |
| arch-engine/src/writer/flow-md.ts | 新增 | writeFlowDocs → flow.md + flow.json（原子写） |
| arch-engine/src/writer/index.ts | 修改 | 导出新 writer |
| arch-engine/src/pipeline.ts | 修改 | runStartInit 中 mergeDocumentModel 后插入 entity/flow 扫描与持久化 |
| arch-engine/src/index.ts | 修改 | 导出新类型供 mcp-server 使用 |
| mcp-server/src/ontology/types.ts | 修改 | ProjectOntology 增加 relations? 字段 |
| mcp-server/src/ontology-query.ts | 修改 | querySnapshot 补充 relations（读 entities.json） |
| mcp-server/src/impact-query.ts | 新增 | handleQueryImpact → { entity, layers, relations, note? } |
| mcp-server/src/index.ts | 修改 | 注册 query_impact 第 18 个 MCP 工具 |
| arch-engine/tests/entity-scanners.test.ts | 新增 | JPA/MyBatis/SQL 三源提取 + 合并去重测试 |
| arch-engine/tests/flow-scanner.test.ts | 新增 | flow 推导 + confidence + 批量化 + 复合键 + 空场景测试 |
| arch-engine/tests/pipeline-entity.test.ts | 新增 | pipeline 集成 + 降级 + 原子写测试 |
| mcp-server/tests/impact-query.test.ts | 新增 | query_impact 三级降级 + confidence 排序测试 |
| mcp-server/tests/ontology-query-relations.test.ts | 新增 | query_ontology relations 字段测试 |

### 1.5 风险与未决项

- 高风险：涉及 mcp-server + arch-engine 管线 + 新对外契约 + >8 文件。
- 假阳性：regex 跨层匹配有噪声，通过复合键（moduleSlug:table）+ confidence 标注缓解，为已知 trade-off。
- 增量一致性：entity 变更触发 flow 全量重推，原子写保护 JSON 一致性。

---

## Part 2 — 可执行任务清单

> 由 /implement-plan 按 Task 派发子 Agent 串行执行，每 Task 自动 commit。

### Task 1: 新增类型定义（types.ts）

- [ ] 在 arch-engine/src/types.ts 新增 Entity 层类型：EntityField、EntityDef、EntityRelationKind、EntityRelation、EntityGraph
- [ ] 新增 Flow 层类型：FlowLayer、FlowNode、FlowEdge（含 confidence: high|low）、FlowGraph
- [ ] DocumentModel 增加 entities?: EntityGraph 和 flows?: FlowGraph（向后兼容）
- [ ] ArchNodeKind 增加 "entity-doc" | "flow-doc"
  - **Files:** `arch-engine/src/types.ts`
  - **Verify:** `cd arch-engine; node node_modules/typescript/bin/tsc --noEmit`

### Task 2: Entity 三源扫描器 + 合并

- [ ] 实现 entity-jpa.ts：scanJpaEntities(projectRoot, modules)，正则提取 @Entity/@Table/@Column/@OneToMany，返回 {entities, relations}
- [ ] 实现 entity-mybatis.ts：scanMybatisEntities(projectRoot, modules)，扫 *Mapper.xml 的 resultMap/association/collection
- [ ] 实现 entity-sql.ts：scanSqlEntities(projectRoot)，扫 CREATE TABLE/FOREIGN KEY
- [ ] 实现 entity-merge.ts：mergeEntityGraphs(jpa, mybatis, sql)，moduleSlug:table 复合键去重、字段取并集、relations 合并去重
- [ ] 写 entity-scanners.test.ts：JPA/MyBatis/SQL 各源提取正确性 + 三源合并去重
  - **MCP:** `query_arch` path=`backend`
  - **Files:** `arch-engine/src/scanners/entity-jpa.ts`, `arch-engine/src/scanners/entity-mybatis.ts`, `arch-engine/src/scanners/entity-sql.ts`, `arch-engine/src/scanners/entity-merge.ts`, `arch-engine/tests/entity-scanners.test.ts`
  - **Verify:** `cd arch-engine; npx vitest run tests/entity-scanners.test.ts`

### Task 3: Flow 扫描器（deriveFlowGraph）

- [ ] 实现 flow-scanner.ts：deriveFlowGraph(projectRoot, entityNames, model)
- [ ] 批量化：一次遍历 repository/service/controller 文件提取类型引用集合，再与 entityNames 做交集（O(F*L)与 entity 数解耦）
- [ ] confidence 标注：方法签名/@Autowired 字段 = high；方法体/注释 = low
- [ ] 前端链：复用 model.packages 的 ApiClientContract/RouteEntry/StoreContract，path 与 entity 名交叉匹配
- [ ] 复合键防误关联：同名 entity 不产生跨 module 的 FlowEdge
- [ ] 写 flow-scanner.test.ts：后端链 + 前端链 + confidence + 批量化 + 复合键 + 空场景
  - **MCP:** `query_contract` name=`ApiClientContract`
  - **Files:** `arch-engine/src/scanners/flow-scanner.ts`, `arch-engine/tests/flow-scanner.test.ts`
  - **Verify:** `cd arch-engine; npx vitest run tests/flow-scanner.test.ts`

### Task 4: Entity/Flow Writer + 原子写

- [ ] 实现 entity-md.ts：writeEntityDocs(projectRoot, graph) → entities.md + entities.json（.tmp+rename 原子写）
- [ ] 实现 flow-md.ts：writeFlowDocs(projectRoot, graph) → flow.md + flow.json（.tmp+rename 原子写）
- [ ] writer/index.ts 导出新 writer
  - **Files:** `arch-engine/src/writer/entity-md.ts`, `arch-engine/src/writer/flow-md.ts`, `arch-engine/src/writer/index.ts`
  - **Verify:** `cd arch-engine; node node_modules/typescript/bin/tsc --noEmit`

### Task 5: Pipeline 集成

- [ ] pipeline.ts 的 runStartInit 中 mergeDocumentModel 之后、writeMarkdownTree 之前插入 entity 扫描（仅 config.scanners.java）
- [ ] entityNames 非空时调用 deriveFlowGraph 产出 model.flows
- [ ] 调用 writeEntityDocs/writeFlowDocs 持久化；写入失败 archLog.error 但不抛出
- [ ] buildArchIndex 扩展产出 entity-doc/flow-doc 节点
- [ ] 写 pipeline-entity.test.ts：集成生成 + Java 关闭降级 + 原子写一致性
  - **Files:** `arch-engine/src/pipeline.ts`, `arch-engine/src/index.ts`, `arch-engine/tests/pipeline-entity.test.ts`
  - **Verify:** `cd arch-engine; npx vitest run tests/pipeline-entity.test.ts`

### Task 6: query_ontology relations 字段

- [ ] mcp-server/src/ontology/types.ts 的 ProjectOntology 增加 relations?: EntityRelation[] 字段
- [ ] ontology-query.ts 的 querySnapshot 补充 relations（读 entities.json，失败静默 omit）
- [ ] 写 ontology-query-relations.test.ts：relations 出现/omit/损坏降级
  - **MCP:** `query_contract` name=`ProjectOntology`
  - **Files:** `mcp-server/src/ontology/types.ts`, `mcp-server/src/ontology-query.ts`, `mcp-server/tests/ontology-query-relations.test.ts`
  - **Verify:** `cd mcp-server; npx vitest run tests/ontology-query-relations.test.ts`

### Task 7: query_impact 第 18 个 MCP 工具

- [ ] 实现 impact-query.ts：handleQueryImpact(projectRoot, entity) → { entity, layers, relations, note? }
- [ ] 三级降级：文件缺失/损坏/entity 不在图 → 空结果 + note，不报 isError
- [ ] confidence 排序：high 排在 low 之前
- [ ] index.ts 注册 query_impact 工具
- [ ] 写 impact-query.test.ts：正常 + not found + 文件缺失/损坏 + confidence 排序
  - **Files:** `mcp-server/src/impact-query.ts`, `mcp-server/src/index.ts`, `mcp-server/tests/impact-query.test.ts`
  - **Verify:** `cd mcp-server; npx vitest run tests/impact-query.test.ts`

### Task 8: 全量构建 + 类型检查 + 全套测试 + 契约注册

- [ ] arch-engine 全量 tsc 类型检查
- [ ] mcp-server 全量 tsc 类型检查
- [ ] arch-engine 全套 vitest（241 + 新增）
- [ ] mcp-server 全套 vitest（103 + 新增）
- [ ] 构建 arch-engine dist + mcp-server dist，确保 query_impact 可用
  - **Contracts:** `EntityGraph` -> `arch-engine/src/types.ts`, `FlowGraph` -> `arch-engine/src/types.ts`
  - **Files:** `arch-engine/src/types.ts`
  - **Verify:** `cd arch-engine; node node_modules/typescript/bin/tsc; cd ../mcp-server; node node_modules/typescript/bin/tsc; cd ../arch-engine; npx vitest run; cd ../mcp-server; npx vitest run`
