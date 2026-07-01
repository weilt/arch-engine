# APT v2.0.4 Ontology Drill + AST Entity + RPC Flow Implementation Plan

> **Spec:** docs/superpowers/specs/2026-06-30-apt-v204-enhancement-design.md
> **Command:** /plan-from-spec
> **Status:** approved

**Goal:** arch-engine entity graph on large Java backend: topology drill + AST entity + RPC flow + scanner registry.

**Architecture:** Four capabilities across three layers (mcp-server query / arch-engine scanner / pipeline). Core: FlowLayer += rpc, entity-jpa becomes AST dispatcher with regex fallback, flow-scanner Step 4 RPC edges, pipeline switches to ScannerRegistry traversal.


---

## Part 1 - Technical Plan (APT Addressing)

### 1.1 Scope

Scope: Layered Ontology topology + topic drill, Java AST Entity Scanner, Feign RPC Flow edges, Scanner Registry.

Non-Goals: multi-repo aggregation, backend multi-language (C#/Go/Rust), tree-sitter full replacement, runtime knowledge, visualization.

### 1.2 Design Addressing

N/A (no frontend UI in this spec).

### 1.3 Dependency Addressing Table

| Dependency | Source | Reference | Summary |
|------|------|------|------|
| EntityGraph / EntityDef / EntityRelation | contract | arch-engine/src/types.ts | EntityDef{name,table,moduleSlug,filePath,fields,source}. EntityRelation{from,to,kind,field?,source} |
| FlowGraph / FlowNode / FlowEdge / FlowLayer | contract | arch-engine/src/types.ts | FlowLayer needs rpc added. FlowNode{id,layer,name,filePath?,moduleSlug?} |
| RpcEndpoint / DocumentModel | contract | arch-engine/src/types.ts | RpcEndpoint{id,name,summary,moduleSlug,source}. DocumentModel.entities?/flows? |
| handleQueryOntology | contract | mcp-server/src/ontology-query.ts | snapshot needs topology, topic needs entities/flowSummary |
| handleQueryImpact (LAYER_ORDER) | contract | mcp-server/src/impact-query.ts | LAYER_ORDER needs rpc |
| ProjectOntology / OntologyTopicResult | source | mcp-server/src/ontology/types.ts | needs topology/entities/flowSummary fields |
| parseFeignInterface | source | arch-engine/src/scanners/java-feign.ts | parseFeignInterface(content)->FeignInterface{name,clientRef,methods} |
| scanJpaEntities | source | arch-engine/src/scanners/entity-jpa.ts | pure regex, becomes AST dispatcher |
| deriveFlowGraph | source | arch-engine/src/scanners/flow-scanner.ts | Steps 1-3, needs Step 4 RPC edges |
| mergeEntityGraphs | source | arch-engine/src/scanners/entity-merge.ts | unchanged |
| pipeline runStartInit | source | arch-engine/src/pipeline.ts | entity/flow integration point, switches to registry |
| writeEntityDocs / writeFlowDocs | source | arch-engine/src/writer/ | unchanged, RPC edges auto-write flow.json |
| java-parser | npm | java-parser@3.0.1 | pure JS Chevrotain engine, new dependency |

### 1.4 Modules and Files to Change

| File/Module | Change | Description |
|-----------|--------|-------------|
| arch-engine/src/types.ts | modify | FlowLayer += rpc |
| arch-engine/src/scanners/entity-jpa-regex.ts | new | extract regex logic from entity-jpa.ts |
| arch-engine/src/scanners/entity-jpa-ast.ts | new | AST scanner (java-parser CST visitor) |
| arch-engine/src/scanners/entity-jpa.ts | modify | becomes AST dispatcher + regex fallback |
| arch-engine/src/scanners/flow-scanner.ts | modify | add Step 4 RPC edges |
| arch-engine/src/scanners/registry.ts | new | ScannerPlugin interface + createScannerRegistry |
| arch-engine/src/pipeline.ts | modify | entity/flow switches to registry traversal |
| arch-engine/package.json | modify | add java-parser dependency |
| mcp-server/src/ontology/types.ts | modify | add OntologyTopology + extend return types |
| mcp-server/src/ontology-query.ts | modify | topology aggregation + topic drill |
| mcp-server/src/impact-query.ts | modify | LAYER_ORDER add rpc |
| 6 new test files | new | entity-jpa-ast / flow-rpc / registry / pipeline-registry / ontology-topology / ontology-topic-drill |

Total: 19 files (more than 8, triggers HIGH).

### 1.5 Risks

- HIGH risk: touches mcp-server + arch-engine pipeline + new contracts + new dependency + more than 8 files.
- entity-jpa regression risk: regex extraction must not change existing output. Protect entity-jpa.test.ts.
- pipeline refactor risk: hardcoded to registry, no-entity project must still succeed. Protect pipeline.test.ts.
- java-parser size: pure JS no native deps, verify install size acceptable.

---

## Part 2 - Executable Task List

> Each task is 2-5 min granularity. Dispatched serially by /implement-plan, one sub-agent per task. Each task auto-commits.

### Task 1: Core Type Extensions + Registry Interface

- [ ] Add rpc to FlowLayer type
  - MCP: query_contract name=FlowGraph
  - Files: arch-engine/src/types.ts
- [ ] Create registry.ts: ScannerPhase / ScannerContext / ScannerResult / ScannerPlugin interface + createScannerRegistry empty stub
  - MCP: query_arch path=arch-engine/src/pipeline.ts
  - Files: arch-engine/src/scanners/registry.ts
- [ ] Add OntologyTopology type + ProjectOntology.topology + OntologyTopicResult.entities/flowSummary
  - MCP: query_contract name=handleQueryOntology
  - Files: mcp-server/src/ontology/types.ts
- [ ] Add rpc to LAYER_ORDER (after controller)
  - MCP: query_contract name=handleQueryImpact
  - Files: mcp-server/src/impact-query.ts
- [ ] Verify: cd arch-engine; node node_modules/typescript/bin/tsc --noEmit AND cd mcp-server; node node_modules/typescript/bin/tsc --noEmit
  - Contracts: OntologyTopology, ScannerPlugin

### Task 2: AST Entity Scanner

- [ ] Add java-parser to arch-engine/package.json + npm install
  - MCP: query_arch path=arch-engine/package.json
  - Files: arch-engine/package.json
- [ ] Extract regex logic to entity-jpa-regex.ts (scanJpaEntitiesRegex, identical logic to original scanJpaEntities)
  - MCP: query_contract name=EntityGraph
  - Files: arch-engine/src/scanners/entity-jpa-regex.ts
- [ ] Create entity-jpa-ast.ts: scanJpaEntitiesAst using java-parser CST visitor to extract @Table/@Column/@OneToMany(mappedBy)/generic fields. Single file failure throws (caller degrades)
  - MCP: query_contract name=EntityGraph
  - Files: arch-engine/src/scanners/entity-jpa-ast.ts
- [ ] entity-jpa.ts becomes dispatcher: try AST catch regex fallback. Single file AST exception -> that file goes regex
  - MCP: query_arch path=arch-engine/src/scanners/entity-jpa.ts
  - Files: arch-engine/src/scanners/entity-jpa.ts
- [ ] Verify: cd arch-engine; npx vitest run tests/scanners/entity-jpa-ast.test.ts tests/scanners/entity-jpa.test.ts
  - Contracts: scanJpaEntitiesAst

### Task 3: Feign RPC Flow Step 4

- [ ] flow-scanner.ts deriveFlowGraph add Step 4: iterate service/controller FlowNode source files, regex detect @Autowired FeignClient type names, match model.rpcs, produce rpc FlowNode + service->rpc->service FlowEdge
  - MCP: query_arch path=arch-engine/src/scanners/flow-scanner.ts
  - Files: arch-engine/src/scanners/flow-scanner.ts
- [ ] Error tolerance: no FeignClient -> skip; clientRef unmatched -> dangling rpc node; model.rpcs empty -> skip Step 4; exception -> return Step 1-3 result
  - Files: arch-engine/src/scanners/flow-scanner.ts
- [ ] Verify: cd arch-engine; npx vitest run tests/scanners/flow-rpc.test.ts

### Task 4: Scanner Registry + Pipeline Integration

- [ ] Fill createScannerRegistry: register entity phase (jpa/mybatis/sql/merge) + flow phase plugins. ScannerContext = {projectRoot,modules,model,entityNames?}
  - MCP: query_arch path=arch-engine/src/pipeline.ts
  - Files: arch-engine/src/scanners/registry.ts
- [ ] pipeline.ts runStartInit: entity/flow section from hardcoded to ScannerRegistry traversal (serial by phase: entity then flow). Preserve try/catch + archLog
  - MCP: query_arch path=arch-engine/src/pipeline.ts
  - Files: arch-engine/src/pipeline.ts
- [ ] Verify: cd arch-engine; npx vitest run tests/scanners/registry.test.ts tests/pipeline-registry.test.ts tests/pipeline.test.ts
  - Contracts: createScannerRegistry

### Task 5: Ontology Topology + Topic Drill

- [ ] querySnapshot add topology aggregation (count from entities.json/flow.json/arch-index). Exception -> omit; missing files -> count 0
  - MCP: query_contract name=handleQueryOntology
  - Files: mcp-server/src/ontology-query.ts
- [ ] queryTopic add entities/flowSummary (when topic matches moduleSlug, filter entities.json by module + count flow.json nodes/edges). No match -> omit
  - MCP: query_contract name=handleQueryOntology
  - Files: mcp-server/src/ontology-query.ts
- [ ] Verify: cd mcp-server; npx vitest run tests/ontology-topology.test.ts tests/ontology-topic-drill.test.ts tests/ontology-query.test.ts

### Task 6: Full Regression + Dual-Package Typecheck

- [ ] arch-engine full test suite
  - Verify: cd arch-engine; npx vitest run (all v2.0.3 254 tests + new tests green)
- [ ] mcp-server full test suite
  - Verify: cd mcp-server; npx vitest run (all v2.0.3 112 tests + new tests green)
- [ ] Dual-package typecheck
  - Verify: cd arch-engine; node node_modules/typescript/bin/tsc --noEmit; cd mcp-server; node node_modules/typescript/bin/tsc --noEmit
- [ ] MCP server build + deploy to C:\\Users\\weilt\\.apt\\mcp-server\\dist\\
  - Verify: build succeeds

---

Tasks 1-6 serial. Task 1 is the type foundation. Task 4 depends on Tasks 1-3. Task 5 depends on Task 1. Task 6 is the full regression gate. After implementation use /verify for acceptance.

