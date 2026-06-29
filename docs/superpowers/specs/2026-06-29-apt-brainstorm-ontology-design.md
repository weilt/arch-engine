---
topic: apt-brainstorm-ontology
version: 2.0.2
status: draft
risk: high
date: 2026-06-29
---
# APT 2.0.2 Context-Aware Brainstorming via Ontology Query Layer

## 1. Background and Goal

### 1.1 Problem
The current /auto-brainstorm is a ~30 line risk-grading shell that says execute brainstorming logic but does not inline capabilities. It depends on superpowers:brainstorming skill existing in the environment but APT distributes 10 commands to 5 platforms (Claude Code / Cursor / Qoder / ZCode / Codex) and only some have superpowers installed. On platforms without it /auto-brainstorm is just a prompt and brainstorming capabilities may be lost.
Also AI cannot query the project real state (existing assets contracts architecture design constraints progress) when brainstorming new features. It guesses project structure reusable parts tech stack. This violates APT core value: from soft prompt constraints to hard MCP constraints.
### 1.2 Goal (v2.0.2)

Deliver a context-aware APT-native brainstorming command. AI can query project real state (ontology) before designing new features, basing design on reality not guessing. This version is a finished product the command must be complete usable closed-loop.

- query_ontology MCP tool (17th) - reads existing knowledge layers fusing into snapshot + topic-focused modes
 /auto-brainstorm upgrade - APT-native brainstorming engine inheriting full 9-step flow (minus Visual Companion) + ontology awareness + risk grading + APT workflow integration
 projectMeta config - manually declared project metadata for the snapshot

### 1.3 Non-goals (excluded)

- Data entity/relation layer (tables FK joins) - v2.0.3
 Business process/impact analysis - v2.0.3
 Visual Companion (browser visualization) - not on roadmap
 Vector DB structure change embedding flow change - untouched
 arch-index backfill of utils/enums/pojo nodes - known gap (section 3.3) not fixed this version
 superpowers:brainstorming Visual Companion - not included
 writing-plans skill - not called terminal is /plan-from-spec

### 1.4 Design decisions summary

| Decision | Choice | Reason |
|------|------|------|
| Roadmap | D (ontology query layer first) | entity/relation/process layers depend on ontology base build query layer first to validate AI-queries-project-state core interaction |
| query_ontology modes | C (no-arg snapshot + topic focus) | covers both global awareness and deep focus |
| Tech stack source | manual declaration (projectMeta) | auto-infer unreliable (tested Spring Boot but actually Micronaut) |
| design field | only when design layer detected | pure backend projects do not get empty design block |
| topic matching | semantic primary + name fallback | contracts layer has no vectors needs name substring fallback no existing data structure change |
| brainstorm capability source | C (fully self-contained APT-native) | not affected by superpowers upgrades five-platform behavior consistent |
| ontology injection timing | AI decides autonomously | no fixed injection point AI judges when to query how many times |
| existing-asset reaction | soft hint (spec annotation no blocking) | decision visible traceable but does not block AI design |
| Visual Companion | not included | brainstorm focuses on brain power visualization not meaningful now |
| flow terminal | auto-link /plan-from-spec (low) / stop for approval (high) | reduce manual intervention |
| interaction mode | adaptive (interactive when human present / fully-auto in apt-goal loop) | covers both usage scenarios |

## 2. Existing knowledge layer inventory (verified not fabricated)

### 2.1 .ai/ data sources

| Source | Path | Content | Verified |
|------|------|------|------|
| contracts | .ai/db.json | contracts[] (8) + missingRequests[] | yes keys: contracts missingRequests |
| contract index | .ai/INDEX.md | Registered Contracts table + Pending Missing Requests | yes |
| arch index | .ai/arch/arch-index.json | root + nodes (module/overview/api-doc three kinds) | yes only overview/api/rpc nodes missing utils/enums/pojo see 3.3 |
| arch docs | .ai/arch/backend/{slug}/*.md | overview/api/rpc/utils/enums/pojo/starter.md | yes disk files complete |
| scan state | .ai/arch/last-scan.json | commit + modules[] (assetCount + fileHashes per module) + packages[] | yes anchor c068d41 3 modules 0 packages |
| vector DB | .ai/arch/vectors.db | 4.3MB SQLite | yes |
| design tokens | .ai/design/tokens/*.json | colors/spacing/typography/radii/other | yes |
| design bindings | .ai/design/framework-bindings.json | component library bindings | yes |
| design pages | .ai/design/pages/*.json | page recipes | yes |
| design components | .ai/design/components/*.json | semantic components | yes |
| design profile | .ai/design/profile.json | framework + base info | yes |
| design state | .ai/design/ingest-state.json | ingest state | yes |

### 2.2 .apt/ data sources

| Source | Path | Content |
|------|------|------|
| goal | .apt/goal.md | product goal |
| approvals | .apt/approvals.json | spec approval state |
| status | .apt/status.json | aggregated status snapshot |
| progress | .apt/orchestration/progress.md | task progress table |

### 2.3 Existing MCP tools (16 verified)

mcp-server/src/index.ts has 16 server.tool(...) calls. query_ontology will be the 17th.

### 2.4 Existing status aggregation logic (reusable)

mcp-server/src/status/aggregate.ts already implements full logic to compute phase / loopDone / nextAction from .apt/ state files (8-state decision tree six-condition loopDone). query_ontology imports and reuses it does not reimplement.

## 3. Technical design

### 3.1 Architecture overview

query_ontology (new MCP tool 17th) reads existing knowledge layers and fuses them. /auto-brainstorm upgrade is a fully self-contained APT-native brainstorming engine. No new data layer is created only read-and-fuse.


### 3.2 query_ontology input/output

Input: query_ontology(topic?: string). No topic = global snapshot. With topic (e.g. auth Order) = focused retrieval.

Output - no-arg snapshot (ProjectOntology):

project: { name rootPath techStack[] } | null (from projectMeta null when missing)
status: { phase loopDone nextAction activeGoal? } (from aggregate.ts phase=blocked when missing last-scan)
progress?: { currentTask? doneCount totalCount } (from progress.md when present)
modules: [{ slug name assetCounts: {api rpc util enum pojo starter} }] (count markdown ## headers see 3.3)
packages: [{ slug name framework? assetCounts: {component util enum apiClient route store} }]
contracts: [{ name tsFile }] (from db.json)
design?: { hasTokens hasBindings pages[] components[] } (only when design layer detected)
approvalState?: { specRisk state } (from approvals.json when present)

Excluded fields (cut after discussion):
statusImpact (topic-focus status cross) - topic is domain concept progress is task name semantic mismatch false-positive risk. Status already covered globally in snapshot.
relations (null placeholder) - no null placeholder v2.0.3 adds with version bump.

Output - topic focus (OntologyTopicResult):

topic: string
matchedIn: string[] (which layers hit e.g. [architecture contracts])
assets: [{ path kind title summary score }] (from search_arch semantic search)
contracts: [{ name tsFile }] (name substring fallback: topic lowercased match contract.name lowercased contains)
designPages: string[] (page slug substring match when design layer present)

Fault tolerance: query_ontology always returns 200 (never throws to AI) some fields may be absent. Only exception: arch-index.json completely absent = { error: project not initialized run start-init first }.

### 3.3 Asset counting: read markdown count ## headers (verified)

Context: arch-index.json nodes only index overview/api/rpc three kinds. utils/enums/pojo/starter have no nodes but markdown files exist on disk. Counting children kind suffix gives false zeros.
Method: for each module/package dir .ai/arch/{backend|frontend}/{slug}/ list .md files (exclude overview.md) count ^## lines per file map filename to kind.

Filename to kind map: api.md=api rpc.md=rpc utils.md=util enums.md=enum pojo.md=pojo starter.md=starter components.md=component api-clients.md=apiClient routes.md=route stores.md=store

Verified: auth-starter/utils.md has 1 ## AuthTokenHelper. base-common/pojo.md has 2 ## DictDataResp ## UserResultDTO. base-common/enums.md has 1 ## CommonStatusEnum. Matches actual assets.
Known gap (not fixed this version): arch-index.json node tree missing utils/enums/pojo nodes. query_ontology uses markdown ## counting to bypass.

### 3.4 Layer reading logic

Snapshot mode layer table:

| Field | Source | Read method | On missing |
|------|------|------|------|
| project | arch.config.json projectMeta | JSON parse | project=null |
| status | .apt/ + aggregate.ts | reuse aggregate() catch MissingLastScanError | phase=blocked |
| progress | progress.md | text parse (count DONE rows / total task rows) | field absent |
| modules/packages | .ai/arch/{backend|frontend}/{slug}/*.md | count ## headers (3.3) | empty array |
| contracts | .ai/db.json | JSON parse | empty array |
| design | .ai/design/tokens/ probe + profile.json | file existence check | field absent |
| approvalState | .apt/approvals.json | JSON parse + risk.ts | field absent |

Focus mode layer table:

| Field | Source | Match strategy |
|------|------|------|
| assets | search_arch(topic) | reuse existing MCP vector search |
| contracts | .ai/db.json | topic lowercased match contract.name lowercased contains |
| designPages | .ai/design/pages/ | page slug substring match (when design layer present) |
| matchedIn | computed result | transparent which layers hit |

### 3.5 projectMeta config

New optional ArchConfig.projectMeta field: { name?: string; techStack?: string[] }. Located in arch.config.json alongside embedding/chunking/scanners. DEFAULT_CONFIG.projectMeta=null (not forced). Same pattern as v2.0.1 frontendPackages (types.ts + config.ts).

### 3.6 /auto-brainstorm APT-native brainstorming flow

Fully inherits superpowers:brainstorming 9-step flow (minus Visual Companion) APT-rewritten:

| Step | APT upgraded |
|------|------|
| 1 | Explore project context: AI may call query_ontology() for project overview. AI decides autonomously. |
| 2 | Removed (Visual Companion not included) |
| 3 | Ask clarifying questions one at a time. AI may call query_ontology(topic) anytime to go deeper. |
| 4 | Propose 2-3 approaches with trade-offs + recommendation. |
| 5 | Present design section by section confirm each. Ontology soft hint: annotate detected existing assets. |
| 6 | Write design doc to docs/superpowers/specs/. Spec gets new section: Ontology detection. |
| 6.5 | Risk grading (APT-only inserted here): run risk.ts rules. low -> auto_approved -> auto-link /plan-from-spec. high -> stop for human approval. |
| 7 | Spec self-review: placeholder/consistency/scope/ambiguity. |
| 8 | User reviews spec (high risk only; low auto-skips). |
| 9 | APT replaces terminal: auto-link /plan-from-spec (not superpowers writing-plans). |

Adaptive interaction mode: default interactive (human present AI asks human answers). Inside /apt-goal loop (no human) auto-switch to fully-auto (AI plays both roles). Detection: .apt/goal.md exists and in /apt-goal loop context.
Ontology soft hint mechanism (step 5): when AI discovers existing related assets/contracts via query_ontology the spec Ontology detection section must contain query records + reuse decisions. Makes design-based-on-existing-assets decision visible traceable but non-blocking (soft hint not report_missing).
Risk grading rules (aligned with status/risk.ts): any one triggers high: 1) spec frontmatter explicit risk: high 2) keyword mcp-server / new MCP server 3) keyword arch-engine / arch pipeline 4) new external contract / breaking API 5) > 8 files changed.

## 4. Deliverables checklist

| Deliverable | File | Type |
|------|------|------|
| query_ontology MCP handler | mcp-server/src/ontology-query.ts (new) | read-fuse layer |
| MCP tool registration | mcp-server/src/index.ts (+1 server.tool) | 17th tool |
| Ontology types | mcp-server/src/ontology/types.ts (new) | ProjectOntology/OntologyTopicResult/ProjectMeta |
| Asset counter | mcp-server/src/ontology/asset-counter.ts (new) | read markdown count ## |
| projectMeta type+default | arch-engine/src/types.ts + config.ts (edit) | ArchConfig.projectMeta |
| /auto-brainstorm template | templates/auto-brainstorm.md (rewrite) | APT-native brainstorming engine |
| apt-auto-brainstorm skill | .agents/skills/apt-auto-brainstorm/SKILL.md (new) | Codex skill |
| command distribution | scripts/inject-platform-assets.cjs (edit) | add to distribution list |
| AGENTS.md command table | templates/_agents-md-snippet.md (edit) | command description |
| README.md | README.md (edit) | command count stays 10 (upgrade not new) |
| test | mcp-server/tests/ontology-query.test.ts (new) | query_ontology unit test |
| test | arch-engine/tests/config.test.ts (extend) | projectMeta default |

## 5. Success criteria

- query_ontology() no-arg returns complete project snapshot each layer field correct (against section 2.1 data sources)
query_ontology(auth) returns auth-starter + AuthTokenHelper + related contracts
/auto-brainstorm executes full 9-step flow (no superpowers dependency) spec contains Ontology detection section
Risk grading correctly classifies high/low
Full test suite green (existing 240 + new tests)
tsc --noEmit passes

## 6. Roadmap

v2.0.3 (Java full-stack complete form):
Data entity layer: scan SQL DDL/migrations + JPA/MyBatis entities -> entity graph (entities fields PK FK joins indexes)
Business process/flow layer: model workflows -> query_impact (changing Order affects what)
query_ontology adds relations field (v2.0.2 omits v2.0.3 introduces with version bump)
Java full-stack coverage: backend entity/repository/service/controller full chain + frontend apiClient/route/store/entity relations

v2.0.4 (unified context gateway):
Fuse status/contracts/design/pages/entities/relations/processes into coherent graph
query_project_context single entry

## 7. Risk self-assessment

This spec self-rates HIGH:
Keyword hit: mcp-server (new 17th MCP tool)
Keyword hit: arch-engine (arch.config.json + types.ts + config.ts changes)
New external contracts: ProjectOntology / OntologyTopicResult / ProjectMeta three new types
Files changed > 8 (section 4 deliverables list ~12 files)

Note: HIGH risk means /auto-brainstorm will set spec status=draft phase=spec_pending_approval and stop for human approval before /plan-from-spec.

