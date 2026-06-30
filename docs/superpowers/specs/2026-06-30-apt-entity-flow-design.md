---
title: APT Entity & Flow Ontology Layer
version: 2.0.3
date: 2026-06-30
status: draft
risk: high
phase: spec_pending_approval
---

## Goal

APT v2.0.3 为项目本体图（ontology）增加**实体层（entity layer）**和**数据流层（flow layer）**，使 AI 能查询“一个实体的数据如何流经 repository→service→controller→前端 apiClient→route→store”，以及“改动某实体会影响哪些层”。这是 Java 全栈项目的完全体能力，填补 v2.0.2 仅有静态资产快照、缺少实体关系与数据流向的缺口。

## Scope

1. Entity 层：从 JPA 注解（@Entity/@Table/@Column/@OneToMany 等）、MyBatis XML mapper（resultMap/association/collection）、SQL DDL（CREATE TABLE/FOREIGN KEY）三源提取实体定义与实体间关系。
2. Flow 层：通过正则跨层类型名交叉匹配，静态推导 entity→repository→service→controller→api-client→route→store 的数据流向图。
3. 查询能力：query_ontology 新增 relations 字段；新增第 18 个 MCP 工具 query_impact。
4. 全部复用既有扫描框架（fast-glob + 正则），不引入新依赖（无 tree-sitter、无图数据库）。

## Non-Goals

- 后端多语言支持（Python/C#/Go/Rust），留待后续版本。
- 可视化图谱（graph visualization），brainstorm 场景不需要，留待后续。
- 实时变更追踪 / 热重载，entity/flow 是 start-init 时的静态快照。
- AST 级精确解析（tree-sitter），本版用 regex + 置信度标注，假阳性为已知 trade-off。
- 前端重新扫描，前端 flow 复用 v2.0.1 既有契约（ApiClientContract/RouteEntry/StoreContract）。

## Acceptance Criteria

1. 对一个含 JPA @Entity + MyBatis mapper + SQL DDL 的 Java 项目执行 start-init 后，生成 .ai/arch/entities.json、flow.json、entities.md、flow.md。
2. query_ontology() 返回的 snapshot 包含 relations 字段（EntityRelation[]）。
3. query_impact("Order") 返回该实体被引用的层列表（layers）及关系列表（relations），高置信引用排在低置信之前。
4. 无 entity 的项目（纯前端）start-init 正常成功，entities/flow 文件不生成。
5. entities.json/flow.json 缺失或损坏时，query_ontology 静默 omit relations，query_impact 返回空结果 + note 说明，两者均不报 MCP 错误。
6. 全部新增测试通过（约 25-30 个 test case），不依赖 LLM API。

## Design

### Architecture

三层渐进式设计，全部在既有包内，无新包、无新依赖：

1. **Scanner 层**（arch-engine/src/scanners/）— 4 个新 scanner：entity-jpa.ts、entity-mybatis.ts、entity-sql.ts、flow-scanner.ts。全部基于正则，复用 java-assets.ts 的 fast-glob candidate 框架。
2. **Graph 层**（arch-engine/src/types.ts + writer/）— 新类型：EntityGraph、FlowGraph、EntityDef、EntityRelation、FlowEdge、FlowNode。DocumentModel 新增 entities?/flows? 字段。新 writer：entity-md.ts、flow-md.ts。arch-index 新增 entity-doc/flow-doc 节点类型。
3. **Query 层**（mcp-server/）— query_ontology 增加 relations? 字段。新增 impact-query.ts handler + query_impact 注册为第 18 个 MCP 工具。

### Components

#### 新增类型 — arch-engine/src/types.ts

Entity 层类型：

- EntityField: { name: string, type: string, column?: string, nullable?: boolean }
- EntityDef: { name, table, moduleSlug, filePath, fields: EntityField[], source: "jpa"|"mybatis"|"sql" }
- EntityRelationKind: "one-to-many" | "many-to-one" | "one-to-one" | "many-to-many" | "fk-reference"
- EntityRelation: { from: string, to: string, kind: EntityRelationKind, field?: string, source: "jpa"|"mybatis"|"sql" }
- EntityGraph: { entities: EntityDef[], relations: EntityRelation[] }

Flow 层类型：

- FlowLayer: "entity" | "repository" | "service" | "controller" | "api-client" | "route" | "store"
- FlowNode: { id: string, layer: FlowLayer, name: string, filePath?: string, moduleSlug?: string }
- FlowEdge: { from: string, to: string, label?: string, confidence: "high"|"low" }
- FlowGraph: { nodes: FlowNode[], edges: FlowEdge[] }

DocumentModel 增加 entities?: EntityGraph 和 flows?: FlowGraph（向后兼容）。
ArchNodeKind 增加 "entity-doc" | "flow-doc"。

#### 新增 4 个 scanner — arch-engine/src/scanners/

- entity-jpa.ts: scanJpaEntities(projectRoot, modules) -> { entities: EntityDef[], relations: EntityRelation[] }
- entity-mybatis.ts: scanMybatisEntities(projectRoot, modules) -> { entities, relations }
- entity-sql.ts: scanSqlEntities(projectRoot) -> { entities, relations }
- flow-scanner.ts: deriveFlowGraph(projectRoot, entityNames: string[], model: DocumentModel) -> FlowGraph

deriveFlowGraph 三步：

1. 收集所有 entity 名称集合（来自上面三个 scanner 的结果）。
2. 在 repository/service/controller 方法体中正则搜索 entity 名出现（批量化：一次遍历所有文件提取类型引用集合，再与 entity 名集做集合交集，复杂度 O(F*L) 与 entity 数解耦）。
3. 复用 model.packages 既有前端契约（不重新扫描），产出 apiClient->route->store->entityRef 的 FlowEdge。

#### 新增 writer — arch-engine/src/writer/

- entity-md.ts: writeEntityDocs(projectRoot, graph) -> 输出 .ai/arch/entities.md + entities.json
- flow-md.ts: writeFlowDocs(projectRoot, graph) -> 输出 .ai/arch/flow.md + flow.json

文件写入采用原子写（先写 .tmp 再 rename），保证 entities.json 和 flow.json 不会出现半写入状态。

#### Pipeline 集成 — arch-engine/src/pipeline.ts

在 mergeDocumentModel 之后、writeMarkdownTree 之前插入 entity 扫描与 flow 推导。仅当 config.scanners.java 开启且发现 entity 时执行。Java 扫描关闭时跳过，pipeline 正常继续。

#### MCP 查询层 — mcp-server/src/

- ontology-query.ts 的 querySnapshot 增加 relations 字段（从 entities.json 读取）。
- 新增 impact-query.ts: handleQueryImpact(projectRoot, entity) -> { entity, layers: {layer, references}[], relations: EntityRelation[], note?: string }
- index.ts 注册第 18 个 MCP 工具 query_impact。

### Data Flow

**扫描时序（写侧）**：start-init 触发，entity/flow 全程不经过 AI summarize/embedding 管线，是确定性正则推导。entity 扫描约 3-8 秒（5000 文件），flow 推导批量化后约 5-10 秒，占总扫描时间 2-5%。

**查询时序（读侧）**：纯读 JSON，不依赖向量库。即使 embedding 服务不可用，ontology 的 relations 和 query_impact 仍然可用。

**关键约束**：

1. entity 去重键 = moduleSlug:table（复合键），防止跨模块同名实体误关联。JPA @Table、MyBatis resultMap、SQL CREATE TABLE 三源指向同表时字段取并集、relations 合并去重。
2. flow 边方向统一为数据流向：entity（离数据近）-> repository -> service -> controller -> api-client -> route -> store（离用户近）。
3. flow 推导假阳性容忍：regex 跨层匹配有噪声，通过 confidence 字段标注（high = 方法签名/@Autowired 字段引用；low = 方法体内部/注释引用）。query_impact 返回时 high 排序在前。
4. flow 推导批量化：一次遍历所有文件提取类型引用集合，再与 entity 名集做交集，复杂度与 entity 数解耦。超大型项目（800 entity、5000 文件）仍可秒级完成。

**超大型项目分析结论**：不引入图数据库。规模差三个数量级（最大 800 节点 + 3 万边，微秒级内存遍历），查询模式极简（一跳邻接），零依赖是核心优势。真正的风险是正则假阳性，通过复合键 + 置信度标注缓解。

### Error Handling

**扫描阶段（写侧）逐文件容错**：单个文件解析失败跳过并 archLog.warn，不阻塞整轮扫描。无 entity 发现时 model.entities/flows 均为 undefined，pipeline 正常继续。entity/flow JSON 写入失败时 archLog.error 但不抛出，不影响既有 arch-index 生成。entity 扫描失败不等于 start-init 失败。

**查询阶段（读侧）三级降级**：

query_ontology：entities.json 正常则补充 relations 字段；不存在/损坏则静默 omit（其余字段照常工作）。

query_impact：文件缺失返回 note "entity/flow index not built"；损坏返回 note "index corrupt, rerun start-init"；entity 不在图中返回 note "entity not found"。永不返回 isError，用空结果 + note 提供可解释反馈。

**增量扫描一致性保护**：entity 变更触发 flow 全量重推。文件写入用原子写（.tmp + rename），保证两个 JSON 要么都完整、要么都未更新。

### Testing

测试遵循既有模式：vitest + 真实磁盘 fixture（tmpdir + mkdtemp），不 mock。新增 5 个测试文件：

1. **entity-scanners.test.ts**（arch-engine）：JPA/MyBatis/SQL 三源提取正确性 + 三源去重合并。
2. **flow-scanner.test.ts**（arch-engine）：后端链推导 + 前端链推导 + confidence 标注 + 批量化验证 + 复合键防跨模块误关联 + 空场景。
3. **pipeline-entity.test.ts**（arch-engine）：pipeline 集成（entities.json/flow.json 生成 + arch-index 节点）+ Java 扫描关闭时降级 + 原子写一致性。
4. **impact-query.test.ts**（mcp-server）：正常查询 + entity not found + 文件缺失 + 文件损坏 + confidence 排序。
5. **ontology-query-relations.test.ts**（mcp-server）：relations 字段出现/omit/损坏降级。

总新增约 25-30 个 test case，全部不依赖 LLM API，CI 可全量运行。测试重点放在假阳性控制（复合键、置信度）和降级容错（文件缺失/损坏）。

## Ontology Detection

### Query 记录

Brainstorming 过程中调用了 query_ontology()（dogfood），获取项目全景快照。检测到以下既有资产：

### 检测到的既有资产

1. **前端契约（v2.0.1）**：ApiClientContract、RouteEntry、StoreContract 已存在于 types.ts 和 frontend scanner 中。flow-scanner.ts 的前端链推导直接复用这些类型，不重新扫描前端。
2. **ProjectOntology（v2.0.2）**：query_ontology 已返回 status/modules/packages/contracts/design。v2.0.3 在此基础上增加 relations 字段，不重构既有结构。
3. **java-assets.ts candidate 框架**：fast-glob + 正则 + RawCandidate 模式被 4 个新 scanner 复用。
4. **writer 框架**：arch-index.ts / asset-md.ts / markdown.ts 的写入模式被 entity-md.ts / flow-md.ts 复用。
5. **pipeline.ts 集成点**：mergeDocumentModel 之后的 model 对象是 entity/flow 注入的精确位置。

### 复用 / 不复用决策

- **复用** ApiClientContract / RouteEntry / StoreContract：前端 flow 推导完全基于既有契约，零额外扫描。
- **复用** java-assets.ts fast-glob 框架：4 个新 scanner 的文件发现逻辑一致。
- **复用** writer 原子写模式：entity/flow JSON 与 arch-index.json 同样的 .tmp+rename 策略。
- **不复用** AI summarize / embedding 管线：entity/flow 是确定性正则推导，不需要 LLM。
- **不复用** RawCandidate 类型：entity/flow 返回结构化图（EntityDef/FlowEdge），不是 RawCandidate。

### 已知 Bug（非本 spec 范围）

query_ontology 报告 design.hasBindings: true 但仓库无 .ai/design/framework-bindings.json。根因在 v2.0.2 Task 4 的 getFrameworkBindingsPath 逻辑。不阻塞 v2.0.3 设计，应作为 2.0.2 patch 修复。

## Risk Assessment

本 spec 为 **HIGH** 风险，依据：

1. 涉及 mcp-server（新增 query_impact 第 18 个 MCP 工具）。
2. 涉及 arch-engine 架构管线（新增 4 个 scanner + pipeline 集成）。
3. 新增对外契约（query_impact MCP 工具 + EntityGraph/FlowGraph 类型）。
4. 拟改动 > 8 个文件（4 新 scanner + 2 新 writer + 1 新 impact-query + types.ts 改 + pipeline.ts 改 + ontology-query.ts 改 + index.ts 改 + mcp ontology types 改 = ~10 文件）。

按 APT 规则，HIGH 风险 spec 必须停等人批，未收到「批准 spec」前不进入 /plan-from-spec。
