# Call Graph + Frontend Impact Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-06-30-call-graph-impact-design.md`
> **Command:** `/plan-from-spec`
> **Status:** approved

**Goal:** 补全方法级调用图、DTO/VO 类型跟踪、运行时行为注解、前端组件 import 图,使 query_impact 从"实体影响哪些层"升级到"改方法/DTO/组件谁会断";并修复 refresh_asset 对 TS 源码推断失败的操作 bug。

**Architecture:** 新增独立 CallGraph 数据结构(方法节点 + DTO 节点 + 4 类边),与 EntityGraph/FlowGraph 平行。两个新扫描器(java-parser AST + ES import/Vue 模板)注册到 ScannerRegistry 新 call-graph phase,产出 .ai/arch/call-graph.json。query_impact 与 query_ontology 在现有容错模式下扩展返回值,不新增 MCP 工具。Bug 5 修复 map-file.ts 复用 start-init 内容分类逻辑。所有改动 non-fatal,失败只 warn 不中断 pipeline。

---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束

**范围:** 方法级调用图(后端)、DTO/VO 跟踪、6 类运行时注解、前端 import/template 图、refresh_asset TS bug 修复。全部融入现有 18 个 MCP 工具。

**非目标:** 不做跨类型字段映射(不猜 OrderDTO.name → Order.name);不做前端完整数据流(路由→store→api 链留 v2.0.6);不加新 MCP 工具;不扩展 FlowGraph;不引入图数据库。

### 1.2 设计寻址（无 UI）

N/A — 本版本纯后端图谱 + MCP 查询层增强,无前端 UI。

### 1.3 依赖寻址表

> arch-engine 自身的 .ai/arch 未初始化(本项目扫描自身无意义),依赖寻址基于直接阅读源码实证。所有依赖均在现有代码库内,无 report_missing。

- CST structural walking 模式 — arch — `arch-engine/src/scanners/entity-jpa-ast.ts` — java-parser Chevrotain CST 遍历模式(isToken/nodes/tokens/collectTokens helper),call-graph-java 沿用
- ScannerPlugin 接口 — arch — `arch-engine/src/scanners/registry.ts` — phase/scan/ScannerContext/ScannerResult,新增 call-graph phase 注册
- detectBackendLayer — arch — `arch-engine/src/scanners/flow-scanner.ts` — 层级判定(repository/service/controller),call-graph-java 复用
- extractVueContract templateTags — arch — `arch-engine/src/scanners/frontend-vue-contract.ts` — Vue SFC 模板标签提取,call-graph-frontend 模板边复用
- isStoreFile/isApiClientFile/isRouterFile — arch — `arch-engine/src/scanners/frontend-{store,api,router}.ts` — 内容分类函数,map-file.ts Bug 5 修复复用
- discoverExports — arch — `arch-engine/src/scanners/ts-export.ts` — TS 文件导出名提取,call-graph-frontend import specifier 匹配复用
- writeFlowDocs 写入模式 — arch — `arch-engine/src/writer/flow-md.ts` — atomicWrite + JSON+MD 双写模式,writeCallGraph 沿用
- ImpactResult 容错模式 — arch — `mcp-server/src/impact-query.ts` — EMPTY/分层 try-catch/省略字段模式,新查询层沿用
- OntologyTopology — arch — `mcp-server/src/ontology/types.ts` — topology 类型,新增 4 字段扩展
- deriveTopology 模式 — arch — `mcp-server/src/ontology-query.ts` — JSON 读取 + try/catch 计数模式,topology 扩展沿用
- getArchDir — arch — `arch-engine/src/paths.ts` — .ai/arch 目录定位,call-graph.json 写入路径

### 1.4 拟改动模块与文件

**arch-engine:**

1. `src/types.ts`(修改) — 新增 CallGraphNodeKind/CallGraphNode/CallGraphEdgeKind/CallGraphEdge/CallGraph 类型;DocumentModel 加 callGraph?
2. `src/scanners/call-graph-java.ts`(新增) — 后端:方法定义/调用/DTO/注解提取(java-parser AST)
3. `src/scanners/call-graph-frontend.ts`(新增) — 前端:ES import + Vue 模板边提取
4. `src/scanners/registry.ts`(修改) — ScannerPhase 加 "call-graph";注册 2 个新插件
5. `src/pipeline.ts`(修改) — call-graph phase 执行(后端 modules + 前端 packageDirs);写 call-graph.json
6. `src/writer/call-graph.ts`(新增) — 写 call-graph.json + call-graph.md(沿用 flow-md 的 atomicWrite)
7. `src/discovery/map-file.ts`(修改) — Bug 5:移除首字母检查,改为内容分类
8. `src/index.ts`(修改) — 导出 CallGraph 类型族 + writeCallGraph + 扫描器

**mcp-server:**

9. `src/impact-query.ts`(修改) — 增加 callers/callees/annotations/dto-fields/importers/imports/templateUsers 分层查询
10. `src/ontology-query.ts`(修改) — deriveTopology 增加 4 字段;queryTopic 增加 methods/dtos drill
11. `src/ontology/types.ts`(修改) — OntologyTopology 加 methodCount/dtoCount/callEdgeCount/importEdgeCount

### 1.5 风险与未决项

- **方法调用 AST 复杂度:** java-parser 的 methodInvocation 节点结构需要实际验证(调用者表达式 qualifier 可能是 PrimaryExpression 多层嵌套)。Task 2 优先用最小可行提取(this/字段两类),未知调用者丢弃,后续版本可扩展。
- **import 路径解析:** 相对路径 + 包目录解析可能遇到 path alias(@/ xxx)。Task 3 先处理相对路径(./ ../),alias 留 TODO。
- **call-graph.json 体量:** 大项目(200+ service)可能产出数千方法节点。query_impact 按需读取,不做全量预加载。

---

## Part 2 — 可执行任务清单

> 实现时由 `/implement-plan` 按 Task 派发子 Agent 串行执行。每 Task 全新上下文 + 自动 git commit。每步带 Files(白名单)和 Verify(验收命令)。

### Task 1: CallGraph 类型定义（types.ts + index.ts）

- [ ] 在 `arch-engine/src/types.ts` 新增 CallGraph 类型族:
  - CallGraphNodeKind = "method" | "dto"
  - CallGraphNode(id/kind/name/filePath?/moduleSlug?/layer?/fields?/annotations?/signature?)
  - CallGraphEdgeKind = "calls" | "imports" | "uses" | "template"
  - CallGraphEdge(from/to/kind/confidence)
  - CallGraph(nodes/edges)
  - DocumentModel 加 callGraph?: CallGraph
  - **Files:** `arch-engine/src/types.ts`
- [ ] 在 `arch-engine/src/index.ts` 导出 CallGraph 类型族,紧跟现有 FlowGraph 导出块之后
  - **Files:** `arch-engine/src/index.ts`
  - **Verify:** `cd arch-engine; node node_modules/typescript/bin/tsc --noEmit`

### Task 2: 后端调用图扫描器（call-graph-java.ts）

- [ ] 创建 `arch-engine/src/scanners/call-graph-java.ts`:
  - 导出 `scanCallGraphJava(projectRoot, modules, model): Promise<CallGraph>`
  - 复用 entity-jpa-ast.ts 的 CST structural walking 模式(isToken/nodes/tokens/collectTokens/typeText helper)
  - 方法定义:遍历 classBodyDeclaration → classMemberDeclaration → methodDeclaration,提取方法名/返回类型/参数 → signature
  - 方法注解:过滤 6 类(@Transactional/@Cacheable+@CacheEvict+@CachePut/@PreAuthorize+@PostAuthorize+@Secured/@Scheduled/@EventListener/@Async),简单类名匹配
  - 方法调用:DFS 遍历方法体找 methodInvocation;this/无调用者 → 同类调用(边 method:ThisClass#callee);@Autowired/private 已知字段类型 → 跨类(边 method:FieldType#callee,high);未知 → 丢弃
  - DTO 识别:类名匹配 /(DTO|VO|Request|Response|Dto|Vo)$/ 或 controller 签名 @RequestBody/返回类型;提取所有 instance field → fields
  - uses 边:方法签名引用 DTO → 边 method:X#foo → dto:OrderDTO
  - 降级:单文件 parse 失败 skip(non-fatal);只扫 service/controller/repository 层文件(detectBackendLayer 复用)
  - **Files:** `arch-engine/src/scanners/call-graph-java.ts`
- [ ] 写测试 `arch-engine/tests/scanners/call-graph-java.test.ts`:
  - fixture:含 @Transactional findById 的 Service + @RequestBody OrderDTO 的 Controller
  - 断言:方法节点存在、calls 边(this/跨类)、uses 边(DTO)、annotations 含 @Transactional
  - **Files:** `arch-engine/tests/scanners/call-graph-java.test.ts`
  - **Verify:** `cd arch-engine; npx vitest run tests/scanners/call-graph-java.test.ts`

### Task 3: 前端 import 图扫描器（call-graph-frontend.ts）

- [ ] 创建 `arch-engine/src/scanners/call-graph-frontend.ts`:
  - 导出 `scanCallGraphFrontend(projectRoot, packageDirs, packages): Promise<CallGraph>`
  - ES import:正则匹配 import 语句(specifier + source path);相对路径(./ ../)解析为绝对路径;解析目标文件导出名(discoverExports 复用)→ 匹配 specifier;边 component:Importer --imports--> component:Exporter,high
  - Vue 模板:复用 extractVueContract 的 templateTags;边 component:Parent --template--> component:Child,high
  - 降级:单文件解析失败 skip;import 目标不存在(外部依赖)skip 该边;非相对路径(path alias)暂记 TODO 跳过
  - **Files:** `arch-engine/src/scanners/call-graph-frontend.ts`
- [ ] 写测试 `arch-engine/tests/scanners/call-graph-frontend.test.ts`:
  - fixture:App.vue import UserCard.vue + UserCard 在模板里用;两个 TS 文件 import 链
  - 断言:imports 边存在、template 边存在
  - **Files:** `arch-engine/tests/scanners/call-graph-frontend.test.ts`
  - **Verify:** `cd arch-engine; npx vitest run tests/scanners/call-graph-frontend.test.ts`

### Task 4: Registry + Pipeline + Writer 集成

- [ ] 修改 `arch-engine/src/scanners/registry.ts`:
  - ScannerPhase 加 "call-graph"
  - ScannerResult 加 callGraph?: CallGraph
  - 注册 2 个 call-graph phase 插件(call-graph-java 传 modules + model;call-graph-frontend 传 packageDirs + packages)
  - **Files:** `arch-engine/src/scanners/registry.ts`
- [ ] 创建 `arch-engine/src/writer/call-graph.ts`:
  - 导出 `writeCallGraph(projectRoot, graph)` — 写 call-graph.json + call-graph.md(沿用 flow-md.ts 的 atomicWrite + renderMarkdown 模式)
  - **Files:** `arch-engine/src/writer/call-graph.ts`
- [ ] 修改 `arch-engine/src/pipeline.ts`:
  - 在 flow phase 之后、markdown 写入之前,执行 call-graph phase(遍历 registry phase==="call-graph" 插件)
  - 合并后端 + 前端结果到 model.callGraph
  - model.callGraph 存在时调 writeCallGraph(跟 writeEntityDocs/writeFlowDocs 同层)
  - **Files:** `arch-engine/src/pipeline.ts`
- [ ] 修改 `arch-engine/src/index.ts` 导出 writeCallGraph + scanCallGraphJava + scanCallGraphFrontend
  - **Files:** `arch-engine/src/index.ts`
  - **Verify:** `cd arch-engine; node node_modules/typescript/bin/tsc --noEmit; npx vitest run tests/scanners/registry.test.ts --testTimeout=30000`
  - **Contracts:** `CallGraph` → `arch-engine/src/types.ts`

### Task 5: refresh_asset TS bug 修复（map-file.ts）

- [ ] 修改 `arch-engine/src/discovery/map-file.ts` 的 TS 分支:
  - 移除 `if (!/^[A-Z]/.test(base)) return null` 首字母检查
  - 改为内容分类:isStoreFile → store;isApiClientFile → api-client;isRouterFile → route;export default function 或 PascalCase export → component;其余 → util
  - 导入 isStoreFile/isApiClientFile/isRouterFile(从 frontend-store/api/router)
  - **Files:** `arch-engine/src/discovery/map-file.ts`
- [ ] 写测试覆盖 lowercase TS 文件(stores/user.ts、utils/format.ts)正确分类
  - **Files:** `arch-engine/tests/discovery/map-file.test.ts`(新增)
  - **Verify:** `cd arch-engine; npx vitest run tests/discovery/map-file.test.ts`

### Task 6: query_impact 扩展（impact-query.ts）

- [ ] 修改 `mcp-server/src/impact-query.ts`:
  - 读 call-graph.json(fault-tolerant:缺失/corrupt → 新字段全省略,原有 entity/flow 查询不受影响)
  - 匹配 DTO(entity 参数匹配 dto: 节点)→ 返回 fields + uses 边指向的方法列表
  - 匹配方法(entity 参数含 "." → Class.method;或匹配 method: 节点 name)→ 返回 callers(calls 反向)/callees(calls 正向)/annotations
  - 匹配前端组件(匹配 component: 节点)→ 返回 importers(imports 反向)/imports(imports 正向)/templateUsers(template 反向)
  - 匹配 entity(原有)→ 附加 call-graph 中引用该 entity 的 DTO/方法
  - ImpactResult 类型扩展(可选字段,call-graph 缺失时省略)
  - **Files:** `mcp-server/src/impact-query.ts`
- [ ] 写测试 `mcp-server/tests/impact-query-callgraph.test.ts`:
  - fixture call-graph.json:方法 + DTO + 组件节点 + 各类边
  - 断言:方法查询返回 callers/callees/annotations;DTO 查询返回 fields/uses;组件查询返回 importers/imports;call-graph.json 缺失时降级
  - **Files:** `mcp-server/tests/impact-query-callgraph.test.ts`
  - **Verify:** `cd mcp-server; node node_modules/typescript/bin/tsc --noEmit; npx vitest run tests/impact-query-callgraph.test.ts`

### Task 7: query_ontology topology + topic drill 扩展

- [ ] 修改 `mcp-server/src/ontology/types.ts`:
  - OntologyTopology 加 methodCount/dtoCount/callEdgeCount/importEdgeCount(全 optional number)
  - **Files:** `mcp-server/src/ontology/types.ts`
- [ ] 修改 `mcp-server/src/ontology-query.ts`:
  - deriveTopology 增加 call-graph.json 计数(methodCount=kind method;dtoCount=kind dto;callEdgeCount=edge calls;importEdgeCount=edge imports/template),各 try/catch 独立,缺失 → 0
  - queryTopic 增加方法/DTO drill(topic 匹配 moduleSlug 时,统计该 module 的 method/dto 节点数)
  - **Files:** `mcp-server/src/ontology-query.ts`
- [ ] 扩展 `mcp-server/tests/ontology-topology.test.ts` 断言 4 个新字段
- [ ] 扩展 `mcp-server/tests/ontology-topic-drill.test.ts` 断言 methods/dtos drill
  - **Verify:** `cd mcp-server; node node_modules/typescript/bin/tsc --noEmit; npx vitest run tests/ontology-topology.test.ts tests/ontology-topic-drill.test.ts --testTimeout=30000`
  - **Contracts:** `OntologyTopology` → `mcp-server/src/ontology/types.ts`
