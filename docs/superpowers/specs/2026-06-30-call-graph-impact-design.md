---
title: "v2.0.5 Call Graph + Frontend Impact + refresh_asset Fix"
date: 2026-06-30
version: 2.0.5
status: draft
risk: high
---

# v2.0.5：调用图谱补全 + 前端 Impact + refresh_asset 修复

## 1. Goal

在 v2.0.4 类级本体图谱基础上,补全方法级调用关系、DTO/VO 类型跟踪、运行时行为注解与前端组件 import 图,使 query_impact 从"这个实体影响哪些层"升级到"改这个方法/DTO/组件,谁会断"。同时修复 refresh_asset 对 TS 源码推断失败的操作 bug。

一句话价值:让 AI 从"知道类在哪里"进化到"知道改一行代码的精确爆炸半径"。

## 2. 范围

五个缺口,一个版本交付(全部方案 A,已与用户确认):

- 1. 方法级调用图 — 独立 call-graph.json,方法→方法边,java-parser AST 提取
- 2. DTO/VO 跟踪 — DTO 作为一等类型节点,AST 提取字段,不猜字段映射
- 3. 运行时注解 — 核心 6 类行为注解,存入方法节点 metadata
- 4. 前端 import 图 — ES import + Vue 模板标签,存入 call-graph.json
- 5. refresh_asset TS bug — 按内容推断,复用 start-init 分类逻辑

## 3. 非目标

- 不做跨类型字段映射(不自动推断 OrderDTO.name → Order.name,同名匹配噪声大,留给 AI 推理)
- 不做前端完整数据流(路由→store→api 链留给 v2.0.6)
- 不加新 MCP 工具(全部能力融入 query_impact + query_ontology,维持 18 工具)
- 不扩展 FlowGraph(类级图保持不变,方法级是新独立结构)
- 不引入图数据库(JSON 文件 + 内存索引足够当前规模)

## 4. 验收标准

1. start-init 对含 service/controller 的 Java 项目产出 .ai/arch/call-graph.json,含方法节点 + 方法→方法边
2. start-init 识别 DTO 类(名字含 DTO/VO/Request/Response,或出现在 controller 签名),字段被提取
3. 方法节点携带运行时注解(6 类中出现的)
4. 前端包扫描产出 import 边 + Vue 模板使用边
5. query_impact("OrderService.findById") 返回 callers + callees + annotations
6. query_impact("OrderResponseDTO") 返回 fields + 引用方法列表
7. query_impact("UserCard")(前端组件)返回 importers + imports
8. query_ontology() topology 含 methodCount/dtoCount/callEdgeCount/importEdgeCount
9. refresh_asset 对 stores/user.ts 等 TS 文件不再报错,正确分类
10. arch-engine + mcp-server 全测试绿(含新增测试)

## 5. 设计

### 5.1 数据模型(types.ts)

新增 CallGraph 类型族,与 EntityGraph/FlowGraph 平行:

- CallGraphNodeKind: "method" | "dto"
- CallGraphNode: id, kind, name, filePath?, moduleSlug?, layer?(FlowLayer), fields?(DTO 字段), annotations?(运行时注解), signature?(方法签名)
- CallGraphEdgeKind: "calls"(后端方法→方法) | "imports"(前端 ES import) | "uses"(方法引用 DTO) | "template"(Vue 模板标签)
- CallGraphEdge: from, to, kind, confidence("high"|"low")
- CallGraph: nodes, edges

DocumentModel 新增 callGraph?: CallGraph。

### 5.2 扫描器

新增 ScannerPhase "call-graph",注册两个插件到 registry.ts。

#### 5.2.1 call-graph-java.ts(后端)

复用 entity-jpa-ast.ts 的 CST structural walking 模式(java-parser Chevrotain)。对每个 service/controller/repository Java 文件:

方法定义提取:
1. java-parser 解析,找 classDeclaration
2. 遍历 classBodyDeclaration → classMemberDeclaration → methodDeclaration
3. 提取方法名、返回类型、参数类型 → signature 字段
4. 方法注解过滤到 6 类行为注解 → annotations 字段

6 类行为注解(简单类名匹配):@Transactional、@Cacheable/@CacheEvict/@CachePut、@PreAuthorize/@PostAuthorize/@Secured、@Scheduled、@EventListener、@Async。

方法调用提取:
1. 对每个方法体,DFS 遍历 CST 找 methodInvocation 节点
2. 提取调用者表达式 + 方法名
3. 调用者分类:
   - this / 无调用者 → 同类方法调用 → 边 method:ThisClass#callee
   - 已知字段(class field,@Autowired/private 类型已知)→ 跨类 → 边 method:FieldType#callee,confidence high
   - 未知调用者 → 丢弃(confidence 不足)

DTO 识别:
1. 类名匹配 /(DTO|VO|Request|Response|Dto|Vo)$/
2. 或:在 controller 方法的 @RequestBody/返回类型中出现
3. 提取所有 instance field(不需要 @Column)→ fields 字段

uses 边:方法签名(参数/返回值)引用 DTO 类型 → 边 method:X#foo → dto:OrderDTO

降级策略:单文件 parse 失败 → skip 该文件(non-fatal,跟 entity-jpa-ast 一致)。整体扫描失败 → pipeline catch,callGraph 不写入。

#### 5.2.2 call-graph-frontend.ts(前端)

对每个前端包的 TS/Vue 源文件:

ES import 提取:
1. 正则匹配 import 语句,提取 specifier(default/named) + source path
2. source path 解析为绝对文件路径(相对当前文件 + 包目录)
3. 解析目标文件的导出名 → 匹配 specifier
4. 边:component:Importer --imports--> component:Exporter,confidence high

Vue 模板标签:
1. 复用 frontend-vue-contract.ts 的 templateTags 提取
2. 边:component:Parent --template--> component:Child,confidence high

降级策略:单文件解析失败 → skip(non-fatal)。import 目标文件不存在 → skip 该边(外部依赖)。

### 5.3 Pipeline 集成(pipeline.ts)

在 entity phase 和 flow phase 之后,新增 call-graph phase:
1. 创建 call-graph-java scanner,传入 projectRoot + modules + model
2. 创建 call-graph-frontend scanner,传入 projectRoot + packageDirs + model.packages
3. 合并两端结果到 model.callGraph
4. 写 .ai/arch/call-graph.json(新增 writeCallGraph writer,跟 writeEntityDocs/writeFlowDocs 同层)

增量扫描:call-graph phase 对 affectedModules + affectedPackages 重扫(跟 entity/flow 一致策略)。

### 5.4 MCP 层

#### 5.4.1 query_impact(impact-query.ts)

输入 entity 参数后,分层查询:
1. 匹配 DTO → 读 call-graph.json,返回 fields + uses 边指向的方法列表
2. 匹配方法(Class.method 或纯方法名)→ 读 call-graph.json,返回:
   - callers:谁调用我(calls 边反向)
   - callees:我调用谁(calls 边正向)
   - annotations:我的运行时行为注解
3. 匹配前端组件 → 读 call-graph.json,返回:
   - importers:谁 import 我(imports 边反向)
   - imports:我 import 谁(imports 边正向)
   - templateUsers:谁在模板里用我(template 边反向)
4. 匹配 entity(原有逻辑)→ 保持不变,附加 call-graph 中引用该 entity 的 DTO/方法

所有新增查询 fault-tolerant:call-graph.json 缺失/corrupt → 新字段省略,原有 entity/flow 查询不受影响。

#### 5.4.2 query_ontology(ontology-query.ts)

Snapshot topology 扩展:
- methodCount(call-graph.json 中 kind=method 的节点数)
- dtoCount(kind=dto 的节点数)
- callEdgeCount(kind=calls 的边数)
- importEdgeCount(kind=imports/template 的边数)

Topic mode 扩展:topic 匹配 module slug 时,增加 methods/dtos 计数 drill-down。

OntologyTopology 类型扩展 4 字段。

### 5.5 Bug 5 修复(map-file.ts)

当前 TS 分支:if (!/^[A-Z]/.test(base)) return null — 首字母不大写就放弃。

修复:移除首字母检查,改为内容分类,复用已有扫描器逻辑:
- isStoreFile(content) → kind: store
- isApiClientFile(content) → kind: api-client
- isRouterFile(content) → kind: route
- export default function / PascalCase export → kind: component
- 其他 → kind: util

保证 refresh_asset 与 start-init 分类一致。

### 5.6 错误处理

跟 v2.0.4 一致的 non-fatal 模式:
- 每个 scanner 插件 try/catch,失败只 warn 不中断 pipeline
- call-graph.json 写入失败只 warn,不影响其余流程
- MCP 查询端每层独立 try/catch,缺数据省略字段不报错

### 5.7 测试

arch-engine 新增:
- call-graph-java scanner:fixture(含 service/controller + DTO + @Transactional 方法),断言方法节点/调用边/uses 边/注解
- call-graph-frontend scanner:fixture(含 import + Vue 模板),断言 imports/template 边
- pipeline 集成:call-graph.json 产出 + 增量扫描

mcp-server 新增:
- impact-query:方法查询返回 callers/callees/annotations;DTO 查询返回 fields/uses;组件查询返回 importers/imports;call-graph.json 缺失时降级
- ontology-query:topology 含 4 新字段;topic drill 含 methods/dtos

## 6. Ontology Detection

本 spec 通过直接阅读源码(非 MCP query_ontology,因 arch-engine 自身的 .ai/arch 未初始化)了解既有资产:

- entity-jpa-ast.ts(CST structural walking)→ 复用:call-graph-java 的 AST 提取沿用同一 structural 模式
- flow-scanner.ts detectBackendLayer() → 复用:call-graph-java 复用层级判定
- frontend-vue-contract.ts templateTags → 复用:call-graph-frontend 的模板边提取
- ScannerPlugin 接口 + registry → 复用:新增 call-graph phase 注册到现有 registry
- frontend-api/store/router isXxxFile() → 复用:map-file.ts Bug 5 修复复用内容分类
- impact-query.ts 容错模式 → 复用:新查询层沿用分层 try/catch + 省略字段

无 report_missing:所有依赖均在现有代码库内,无需新外部依赖。

## 7. 改动文件清单(预估)

arch-engine:
1. types.ts(新增 CallGraph 类型族)
2. scanners/call-graph-java.ts(新增)
3. scanners/call-graph-frontend.ts(新增)
4. scanners/registry.ts(新增 call-graph phase + 2 plugins)
5. pipeline.ts(call-graph phase 执行 + 写 call-graph.json)
6. writer/call-graph.ts(新增,写 JSON + markdown)
7. discovery/map-file.ts(Bug 5 修复)
8. index.ts(导出新类型)

mcp-server:
9. impact-query.ts(callers/callees/annotations/dto/components)
10. ontology-query.ts(topology + topic drill)
11. ontology/types.ts(OntologyTopology 扩展)

总计 11 文件,> 8 文件 → 触发 high risk。

## 8. 版本路线

- 2.0.3 Entity + Flow Ontology — SHIPPED
- 2.0.4 Ontology Drill + AST Entity + RPC Flow + Scanner Registry — SHIPPED
- 2.0.5 Call Graph + Frontend Impact + refresh_asset Fix — 本 spec
- 2.0.6 前端完整数据流(路由→store→api)— Planned
- 2.1 跨仓库 workspace + 多语言后端(C#/Go/Rust)— Planned
