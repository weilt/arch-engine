---
title: "v2.1.0 Cross-Repo Workspace + Go Language Support"
date: 2026-07-02
version: 2.1.0
status: draft
risk: high
---

# v2.1.0：跨仓库 Workspace + Go 语言扫描

## 1. Goal

让 APT 从"单仓库 Java + 前端"升级到"多仓库、多语言"架构。企业微服务通常是几十个独立 repo（Java + Go + 前端混部），APT 必须能跨 repo 扫描、建立统一知识图谱、回答跨服务影响链问题。本版本新增 Go 语言 scanner，使 APT 覆盖中国云原生生态最主流的 Java + Go 双后端组合。

一句话价值：让 AI agent 能在一个包含 Java 微服务、Go 微服务、Vue 前端的多 repo 项目里做精确的跨服务影响分析。

## 2. 范围

- 跨仓库 workspace（`apt-workspace.json` 清单 + 多根 pipeline + repo 命名空间知识库）
- Go 语言 scanner（go.mod 模块发现 + HTTP API + gRPC proto + struct 实体 + 函数级调用图）
- 跨 repo RPC/API 影响链（统一索引 + 跨 repo 边检测）
- `query_ontology` / `query_impact` 多 repo 感知

## 3. 非目标

- 不做 RBAC / 审计日志 / 多租户（评估 #2 缺口，推后到独立版本）
- 不做 C# / Rust / Python scanner（v2.1.1+ 以插件增量加入）
- 不做性能 benchmark（独立任务，不混入功能版本）
- 不做前端完整数据流（v2.0.7）
- 不破坏单仓库模式（无 `apt-workspace.json` 时完全向后兼容）
- 不做 RBAC / 用户管理 / 操作日志

## 4. 验收标准

1. `apt-workspace.json` 存在时，`start-init` 扫描清单内所有 repo，合并到统一 `.ai/arch/`
2. `start-init --workspace-init` 自动扫描子目录生成 `apt-workspace.json`（检测 pom.xml / go.mod / package.json / *.csproj）
3. 无 `apt-workspace.json` 时行为与 v2.0.6 完全一致（单仓库兼容）
4. Go repo 扫描产出：HTTP API（gin/echo/chi/net-http）、gRPC 服务（.proto）、struct 实体、函数节点 + 调用边
5. `.ai/arch/backend/<repo-slug>/<module>/` 路径结构，arch-index 树含 repo 层
6. `query_ontology()` topology 含 repoCount + 每 repo 的模块/实体/方法计数
7. `query_impact` 能追踪跨 repo 调用链（repo A 代码引用 repo B 的 API 路径 → 跨 repo 边）
8. `last-scan.json` 按 repo 独立追踪，单 repo 变更只重扫该 repo
9. arch-engine + mcp-server 全测试绿（含新增 Go scanner + workspace 测试）

## 5. 设计

### 5.1 apt-workspace.json 清单格式

workspace 根目录（含所有 repo 的父目录）放置 `apt-workspace.json`：

```json
{
  "repos": [
    {
      "path": "services/order-service",
      "lang": "java",
      "stack": "spring-cloud",
      "name": "Order Service"
    },
    {
      "path": "services/payment-go",
      "lang": "go",
      "stack": "go-grpc",
      "name": "Payment Service (Go)"
    },
    {
      "path": "web/admin-ui",
      "lang": "ts",
      "stack": "vue",
      "name": "Admin UI"
    }
  ]
}
```

字段说明：
- `path`：相对 workspace 根的路径
- `lang`：`"java"` | `"go"` | `"ts"`（决定走哪个 scanner）
- `stack`：技术栈标注（信息性，不影响 scanner 选择，但写入 asset tags）
- `name`：人类可读名称（可选，默认用 path basename）

### 5.2 数据模型扩展（types.ts）

```typescript
export interface WorkspaceRepo {
  path: string;
  lang: "java" | "go" | "ts";
  stack?: string;
  name?: string;
  slug: string;
}

export interface WorkspaceConfig {
  repos: WorkspaceRepo[];
}

export interface GoModule {
  slug: string;
  name: string;
  path: string;
  repoSlug: string;
}

export interface GoStruct {
  name: string;
  fields: { name: string; type: string; tag?: string }[];
  filePath: string;
  moduleSlug: string;
  repoSlug: string;
}

export interface GoApiEndpoint {
  id: string;
  method: string;
  path: string;
  handlerFunc: string;
  framework: "gin" | "echo" | "chi" | "net-http" | "grpc";
  moduleSlug: string;
  repoSlug: string;
}

export interface GoMethodNode {
  id: string;
  receiver: string;
  name: string;
  signature: string;
  filePath: string;
  moduleSlug: string;
  repoSlug: string;
}
```

JavaModule / FrontendPackage 加 `repoSlug?: string`（可选，单仓库模式为空）。
DocumentModel 加 `workspace?: WorkspaceConfig`。

`LastScanState` 加 `repos?: Record<string, { commit: string; branch: string; scannedAt: string }>` 用于 workspace 模式按 repo 独立追踪增量锚点。单仓库模式下该字段为空，走原有 `commit` / `modules` 顶层字段（向后兼容）。

### 5.3 Workspace 加载器（workspace.ts）

新增 `arch-engine/src/workspace.ts`：
- `loadWorkspace(projectRoot): Promise<WorkspaceConfig | null>` — 读 `apt-workspace.json`，无则返回 null（单仓库模式）
- `initWorkspace(projectRoot): Promise<WorkspaceConfig>` — 自动扫描子目录（检测 pom.xml/go.mod/package.json/*.csproj），生成并写入 `apt-workspace.json`
- `resolveRepoRoot(projectRoot, repoPath): string` — 拼绝对路径
- repo slug 生成：path basename，lowercase，`-` 替换非法字符

### 5.4 多根 Pipeline（pipeline.ts）

`runStartInit` 改造为 workspace-aware：

1. 先调 `loadWorkspace(projectRoot)`
2. 返回 null → 走原有单仓库逻辑（零改动）
3. 返回 config → 遍历 repos，每个 repo 按 lang 分发到对应 scanner：
   - `lang: "java"` → 对该 repo root 调 `findMavenModules` + Java scanners，module 加 `repoSlug`
   - `lang: "go"` → 对该 repo root 调 `scanGoSources`，产出 Go API/struct/method
   - `lang: "ts"` → 对该 repo root 调 `scanFrontend`，package 加 `repoSlug`
4. 合并所有 repo 的结果到统一 DocumentModel
5. 写入 workspace 级 `.ai/arch/`（路径含 repo 命名层）

增量扫描：`last-scan.json` 按 repo 独立追踪 commit 锚点。某 repo 无变更则跳过该 repo 重扫。

### 5.5 .ai/arch 目录布局（repo 命名空间）

单仓库（无变化）：
``+.ai/arch/backend/<module>/utils.md
```

多仓库：
```
.ai/arch/backend/<repo-slug>/<module>/utils.md
.ai/arch/backend/order-service/order/utils.md
.ai/arch/backend/payment-go/cmd/api.md
.ai/arch/frontend/admin-ui/components.md
```

arch-index.json 树：
```
backend → order-service → order → utils/api/pojo
        → payment-go → cmd → api
frontend → admin-ui → components/utils/enums
```

entities.json / flow.json / call-graph.json 统一存储，节点含 `repoSlug` 字段。

### 5.6 Go Scanner（go-scanner.ts）

正则提取（Go 语法规则，不需要 AST parser）：

**模块发现：**
- 扫 `go.mod`，提取 `module github.com/example/payment` → module name
- 目录结构：`cmd/` 入口、`internal/` 内部包、`pkg/` 公开包

**HTTP API 提取（4 框架）：**
- gin: `r.GET("/path", handler)` / `r.POST(...)` / `router.Group("/api")`
- echo: `e.GET("/path", handler)`
- chi: `r.Get("/path", handler)` / `r.Route("/api")`
- net/http: `http.HandleFunc("/path", handler)`
- 提取 method + path + handler 函数名 → GoApiEndpoint

**gRPC 服务（.proto 文件）：**
- 扫 `*.proto`，提取 `service PaymentService { rpc Charge(ChargeReq) returns (ChargeResp); }`
- 每个 rpc 方法 → GoApiEndpoint（framework: "grpc"）

**Struct 实体提取：**
- 正则 `type (\w+) struct \{ ... \}`，提取字段 + json tag
- 等同于 Java JPA entity 的角色

**函数定义 + 调用图：**
- `func (s *OrderService) CreateOrder(...) error` → GoMethodNode
- `s.validate()` / `repo.Save()` / `client.GetUser()` → calls 边
- 调用者分类跟 Java call-graph 一致（receiver.method → 同 receiver / 已知字段 / 未知丢弃）

**降级：** 单文件解析失败 → skip（non-fatal）。整体扫描失败 → pipeline catch。

### 5.7 跨 repo RPC/API 影响链

所有 repo 扫描完成后，合并统一索引：
1. 汇总所有 API endpoints（Java REST + Go HTTP + gRPC proto）
2. 汇总所有 RPC endpoints（Java Feign + Go gRPC client calls）
3. 对每个 repo 的 call-graph，检测是否引用了其他 repo 的 API path 或 RPC 服务名
4. 匹配到 → 创建跨 repo 边（`method:RepoA#func` → `rpc:RepoB#Service`）
5. 写入统一 call-graph.json

### 5.8 Scanner Registry 扩展（registry.ts）

ScannerPhase 加 `"go"` 概念（但不需要新 phase，复用 entity/flow/call-graph phase）。
ScannerContext 加 `repoSlug?: string` + `repoLang?: string`。
Registry 按 repo 的 lang 字段路由 scanner：
- Java repo → 现有 entity-jpa/entity-mybatis/entity-sql/flow-derive/call-graph-java
- Go repo → 新增 go-scanner（entity + flow + call-graph 三合一）
- TS repo → 现有 frontend scanner + call-graph-frontend

### 5.9 MCP 层

#### query_ontology
- topology 加 `repoCount`（workspace 模式下 repo 数量）
- modules 列表含 `repoSlug`，可按 repo 分组
- 单仓库模式下 `repoCount: 1`（或省略，向后兼容）

#### query_impact
- 跨 repo 边检测：如果影响链触及其他 repo 的节点，在返回结果中标注 `crossRepo: true`
- 跨 repo 节点的 `moduleSlug` 变为 `repo-slug/module-slug` 格式

#### query_path_rules
- 无变化（路径规则仍是 per-repo 的 Java 概念）

### 5.10 CLI 扩展

- `start-init --workspace-init`：自动扫描生成 `apt-workspace.json`
- `start-init`（有 workspace）：扫描所有 repo
- `start-init`（无 workspace）：单仓库（现有行为）
- `agent-init`：检测 workspace 模式，`APT_PROJECT_ROOT` 指向 workspace 根

### 5.11 错误处理

- 某 repo 目录不存在 → warn + skip（不中断其他 repo）
- 某 repo scanner 失败 → warn + skip（其他 repo 结果正常返回）
- Go 语法不支持的正则匹配 → skip 该文件
- workspace 清单格式错误 → 报错 + 提示修复格式

### 5.12 测试

arch-engine 新增：
- `tests/workspace.test.ts`：workspace 加载、init 生成、向后兼容
- `tests/scanners/go-scanner.test.ts`：Go HTTP/gin fixture + struct + function + call graph
- `tests/scanners/go-proto.test.ts`：.proto 解析
- `tests/pipeline-workspace.test.ts`：多 repo pipeline 集成

mcp-server 新增：
- `tests/ontology-workspace.test.ts`：workspace topology + repo 分组
- `tests/impact-cross-repo.test.ts`：跨 repo 影响链

## 6. Ontology Detection

通过直接阅读源码（arch-engine 自身未初始化 workspace）了解既有资产：

- `findMavenModules` / `scanFrontend` — 复用：多根 pipeline 对每个 repo 调用这些函数，加 repoSlug 参数
- ScannerPlugin registry — 复用：Go scanner 作为新插件注册
- `scanCallGraphJava` 模式 — 复用：Go scanner 的调用图提取沿同一 receiver→method 模式
- `deriveFlowGraph` — 复用：Go struct 作为 entity 节点参与 flow graph
- `loadOrInitConfig` — 复用：workspace 模式共享同一个 arch.config.json
- `query_impact` 容错 — 复用：跨 repo 查询沿用分层 try/catch
- `writeEntityDocs` / `writeFlowDocs` / `writeCallGraph` — 复用：统一图谱写入，节点含 repoSlug

## 7. 改动文件清单（预估 14 文件）

arch-engine:
1. types.ts（WorkspaceRepo/WorkspaceConfig/GoModule/GoStruct/GoApiEndpoint/GoMethodNode + JavaModule.repoSlug?）
2. workspace.ts（新增 — 清单加载 + init）
3. scanners/go-scanner.ts（新增 — Go 全量 scanner）
4. scanners/go-proto.ts（新增 — .proto 解析）
5. scanners/registry.ts（Go scanner 注册 + repo 路由）
6. pipeline.ts（workspace-aware 多根执行）
7. config.ts（workspace config 校验）
8. paths.ts（workspace-aware arch dir）
9. index.ts（导出新类型 + workspace loader + go scanner）
10. scanners/java.ts（JavaModule 加 repoSlug）
11. scanners/frontend.ts（FrontendPackage 加 repoSlug）

mcp-server:
12. ontology-query.ts（repoCount topology + repo 分组）
13. impact-query.ts（跨 repo 边标注）
14. ontology/types.ts（OntologyTopology repoCount）

总计 14 文件，> 8 → high risk。

## 8. 版本路线

- 2.0.3 Entity + Flow Ontology — SHIPPED
- 2.0.4 Ontology Drill + AST Entity + RPC Flow + Scanner Registry — SHIPPED
- 2.0.5 Call Graph + Frontend Impact + refresh_asset Fix — SHIPPED
- 2.0.6 Java API 路径规则增强 + v0 页面交接 — SHIPPED
- **2.1.0 跨仓库 Workspace + Go 语言 — 本 spec**
- 2.1.1 C# / Rust / Python scanner — Planned
- 2.2 性能 benchmark + RBAC + 审计日志 — Planned
