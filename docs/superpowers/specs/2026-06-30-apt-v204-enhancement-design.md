---
title: APT v2.0.4 Ontology Drill + AST Entity + RPC Flow
version: 2.0.4
date: 2026-06-30
status: approved
risk: high
phase: approved
---

## Goal

APT v2.0.4 增强项目本体图在超大型 Java 后端项目上的可靠性：增加分层钻取能力、用 Java AST 替换 entity 扫描的 regex 假阳性、接入 Feign RPC 跨服务调用链、建立 scanner 注册机制为后续多语言铺路。

## Scope

1. 分层 Ontology：query_ontology() 快照增加 topology 拓扑摘要；topic 模式增加实体列表 + flow 摘要。不新增 MCP 工具。
2. Java AST Entity Scanner：java-parser（纯 JS）作为 arch-engine 依赖，entity-jpa.ts 主路径走 AST，regex 降级为 fallback。只替换 entity-jpa，其他 scanner 不动。
3. Feign RPC Flow 边：flow-scanner 增加 Step 4，推导 service→rpc→service 横向边，复用既有 parseFeignInterface 的 clientRef。覆盖单仓库多服务场景。
4. Scanner 注册机制：ScannerPlugin 接口 + registry，pipeline 从硬编码改为遍历 registry，为 2.1 多语言铺路。

## Non-Goals

- 多仓库跨仓库索引聚合（留 2.1 workspace）。
- 后端多语言（C#/Go/Rust，留 2.1）。
- tree-sitter 全量替换（本版只替换 entity-jpa，其他 scanner 保持 regex）。
- 运行时知识（事务、AOP、缓存）。
- 可视化图谱。

## Acceptance Criteria

1. query_ontology() 返回的 snapshot 包含 topology 字段（moduleCount/rpcEndpoints/entityCount/flowEdgeCount/crossServiceRefs）。
2. query_ontology("order-service") 返回 entities 列表和 flowSummary。
3. 含 @OneToMany(mappedBy="order") 的 Java 文件，AST 路径精确提取 mappedBy 参数。
4. java-parser 不可用时，entity-jpa 自动降级 regex，产出与 v2.0.3 一致的结果。
5. 含 @Autowired FeignClient 的 service 文件，flow graph 含 service→rpc→service 横向边。
6. pipeline 通过 registry 跑 scanner，既有行为不回归（无 entity 项目仍正常成功）。
7. v2.0.3 全部 366 测试仍绿，新增约 27-35 测试全绿。

## Design

### Architecture

四个能力分属三层，全部在既有包内：

1. **Query 层**（mcp-server）— query_ontology 快照增加 topology 拓扑摘要；topic 模式增加实体列表 + flow 摘要。不新增 MCP 工具。
2. **Scanner 层**（arch-engine/src/scanners）— entity-jpa.ts 改为 AST 分发器 + regex fallback；flow-scanner.ts 增加 Step 4 RPC 边；新增 registry.ts。
3. **Pipeline 层**（arch-engine/src/pipeline.ts）— 从硬编码改为遍历 ScannerRegistry。

### Components

#### 新增类型 — mcp-server/src/ontology/types.ts

- OntologyTopology: { moduleCount, rpcEndpoints, entityCount, flowEdgeCount, crossServiceRefs }
- OntologyTopicResult 增加: entities?: string[], flowSummary?: { nodes: number; edges: number }
- ProjectOntology 增加: topology?: OntologyTopology

#### 新增类型 — arch-engine/src/scanners/registry.ts

- ScannerPhase: "entity" | "flow" | "asset"
- ScannerContext: { projectRoot, modules, model, entityNames? }
- ScannerResult: { entities?: Partial<EntityGraph>, flows?: Partial<FlowGraph> }
- ScannerPlugin: { name, phase, scan(ctx) }
- createScannerRegistry(): ScannerPlugin[]

#### AST Entity Scanner — arch-engine/src/scanners/entity-jpa-ast.ts（新）

scanJpaEntitiesAst(projectRoot, modules) -> { entities, relations }。用 java-parser CST visitor 精确提取 @Table/@Column/@OneToMany(mappedBy) 参数、泛型字段 List<OrderItem>。

entity-jpa.ts 改为分发器：try AST → catch regex fallback。单文件 AST 失败降级该文件 regex。
entity-jpa-regex.ts（新）：抽离既有 regex 逻辑。

#### Feign RPC Flow 边 — flow-scanner.ts 增加 Step 4

遍历 service/controller FlowNode 源文件，正则检测 @Autowired FeignClient 类型名，匹配 model.rpcs 的 RpcEndpoint.name，产出 FlowNode(layer="rpc") + service→rpc→service FlowEdge。

FlowLayer 增加 "rpc" 值。复用既有 parseFeignInterface 的 clientRef。

#### Topology 计算 — mcp-server/src/ontology-query.ts（改）

querySnapshot 增加 topology 聚合（从 modules/entities.json/flow.json/arch-index 统计）。queryTopic 增加 entities/flowSummary（按 moduleSlug 过滤）。

### Data Flow

**扫描时序**：ScannerRegistry 按 phase 串行驱动。entity phase（AST 主路径 + regex 降级）→ flow phase（Step 1-3 不变 + Step 4 RPC 边）→ asset phase（既有管线）。

AST 降级链三级：全局不可用→整批 regex；单文件失败→该文件 regex；成功→精确结果。

**查询时序**：topology 是纯 JSON 聚合计算（O(1)，不依赖向量库 / LLM。entityCount=0 是有效值（不 omit topology）。

### Error Handling

**AST 降级链**：全局 require 失败→整批 regex；单文件 CST 失败→该文件 regex；两者都失败→跳过。下游 mergeEntityGraphs 不感知来源差异。

**RPC 边容错**：无 FeignClient → 不产 rpc 边；clientRef 无法匹配 → 悬挂 rpc 节点（仅 service→rpc）；model.rpcs 为空 → Step 4 跳过；异常 → flow 图仍返回 Step 1-3 结果。

**Topology 容错**：entities.json/flow.json 缺失 → 对应计数为 0（不 omit topology）；整体异常 → omit topology。

**Registry 容错**：某 plugin 异常 → 跳过继续；entity phase 全名失败 → flow phase 收空 entityNames。

### Testing

新增 7 个测试文件，约 27-35 test case，全部不依赖 LLM API：

1. **entity-jpa-ast.test.ts**：AST 精确提取（mappedBy、泛型、nullable）+ 复杂 Java 不崩溃 + 单文件降级
2. **entity-jpa.test.ts**（扩展）：全局降级 + 混合结果
3. **flow-rpc.test.ts**：service→rpc→service 边 + 无 FeignClient + 悬挂 rpc + 异常容错
4. **registry.test.ts**：串行 phase + 单 plugin 异常 + 空 registry
5. **pipeline-registry.test.ts**：pipeline 通过 registry + 无回归
6. **ontology-topology.test.ts**：完整计数 + 缺失=0 + rpc 边计数 + omit
7. **ontology-topic-drill.test.ts**：topic 钻取 entities/flowSummary + 无匹配 + 损坏降级

v2.0.3 全部 366 测试必须不回归。重点保护 entity-jpa.ts、flow-scanner.ts、ontology-query.ts 的既有测试。

## Ontology Detection

### Query 记录

Brainstorming 过程中调用了 query_ontology() + search_arch。检测到以下既有资产：

### 检测到的既有资产

1. **EntityGraph/FlowGraph/EntityDef/FlowEdge (v2.0.3)**：类型已存在，本版扩展 FlowLayer += "rpc"，其余不动。
2. **parseFeignInterface / FeignInterface (java-feign.ts)**：已提取 clientRef + methods，RPC flow Step 4 直接复用。
3. **model.rpcs (RpcEndpoint[])**：已在 pipeline 中扫描，Step 4 匹配此列表。
4. **query_ontology snapshot/topic (v2.0.2+v2.0.3)**：已有 status/modules/packages/contracts/design/relations，本版增加 topology。
5. **pipeline.ts runStartInit entity/flow 集成点 (v2.0.3)**：本版改为遍历 registry。
6. **writeEntityDocs/writeFlowDocs (v2.0.3)**：原子写不动，新增的 rpc 边自动写入 flow.json。

### 复用 / 不复用决策

- **复用** parseFeignInterface / FeignInterface：RPC flow 完全基于既有 Feign 扫描结果，零额外扫描。
- **复用** model.rpcs：Step 4 匹配既有 RpcEndpoint 列表，不重扫。
- **复用** query_ontology 既有快照/topic 结构：本版只增加字段，不重构。
- **复用** entity-jpa-regex 逻辑：抽离为独立文件，作为 AST fallback。
- **不复用** entity-jpa.ts 旧逻辑：改为分发器，原 regex 逻辑移入 entity-jpa-regex.ts。

## Risk Assessment

本 spec 为 **HIGH** 风险，依据：

1. 涉及 mcp-server（ontology-query.ts 改、types.ts 改）。
2. 涉及 arch-engine 架构管线（pipeline.ts 改、scanner 改、registry 新增）。
3. 新增对外契约（OntologyTopology、ScannerPlugin、AST scanner 导出）。
4. 新增依赖 java-parser。
5. 拟改动 > 8 个文件。

按 APT 规则，HIGH 风险 spec 必须停等人批。
