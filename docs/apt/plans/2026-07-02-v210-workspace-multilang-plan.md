# v2.1.0 Cross-Repo Workspace + Go + Python Implementation Plan

> **Spec:** docs/superpowers/specs/2026-07-02-v210-workspace-multilang-design.md
> **Command:** /plan-from-spec
> **Status:** approved

**Goal:** 让 APT 从单仓库 Java + 前端升级为多仓库、多语言（Java + Go + Python + 前端）架构。

**Architecture:** workspace 清单驱动多根 pipeline；Go/Python 各一个全量正则 scanner（entity + flow + call-graph 三合一）；.proto 解析抽成共享模块；统一 .ai/arch 按 repo-slug 命名；MCP query_ontology/query_impact 多 repo 感知。单仓库模式完全向后兼容（无清单 = 原有行为）。
---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束

**范围：** 跨仓库 workspace（apt-workspace.json 清单 + 多根 pipeline + repo 命名空间）；Go scanner（go.mod + gin/echo/chi/net-http + gRPC proto + struct + 调用图）；Python scanner（pyproject.toml + FastAPI/Flask/Django/Tornado + gRPC proto + SQLAlchemy/Pydantic/Django 实体 + 调用图）；跨 repo RPC/API 影响链；query_ontology / query_impact 多 repo 感知。

**非目标：** 不做 RBAC / 审计日志 / 多租户；不做 C# / Rust scanner（v2.1.1+）；不做性能 benchmark；不做前端完整数据流（v2.0.7）；不破坏单仓库模式。

**约束：** Go/Python 用正则提取（不引入 AST 依赖，与 Java scanner 路线一致）；Python 需缩进感知解析；所有新类型/字段可选化以保证向后兼容。

### 1.2 设计寻址（无 UI 则写 N/A）

N/A — 本功能无前端 UI。

### 1.3 依赖寻址表

> arch-engine 自身 .ai/arch 未初始化 workspace，以下为直接读源码所得的真实集成点。

| 依赖 | 来源 | 摘要 |
|------|------|------|
| DocumentModel | types.ts:94 | 合并模型容器，需加 workspace 字段 |
| JavaModule | types.ts:88 | 加 repoSlug 字段 |
| FrontendPackage | types.ts:50 | 加 repoSlug 字段 |
| LastScanState | types.ts:319 | 加 repos 增量锚点字段 |
| ScannerContext | registry.ts:22 | 加 repoSlug/repoLang 字段 |
| createScannerRegistry | registry.ts:43 | 注册 Go/Python scanner |
| runStartInit | pipeline.ts:394 | 改造为 workspace-aware |
| getArchDir / paths | paths.ts:3 | workspace-aware arch dir |
| findMavenModules / scanJavaSources | java.ts | 多根调用 + repoSlug |
| scanFrontend | frontend.ts | 多根调用 + repoSlug |
| handleQueryOntology | ontology-query.ts:30 | 加 repoCount topology |
| OntologyTopology | ontology/types.ts | 加 repoCount 字段 |
| handleQueryImpact | impact-query.ts | 跨 repo 边标注 |
| index.ts exports | index.ts:1 | 导出新类型 + scanner |
### 1.4 拟改动模块与文件

| 文件/模块 | 变更类型 | 说明 |
|-----------|----------|------|
| arch-engine/src/types.ts | 改 | 新增 Workspace/Go/Python 接口 + repoSlug 字段 + LastScanState.repos |
| arch-engine/src/workspace.ts | 新增 | 清单加载 loadWorkspace + initWorkspace + slug |
| arch-engine/src/scanners/proto-scanner.ts | 新增 | .proto 解析，Go/Python 共享 |
| arch-engine/src/scanners/go-scanner.ts | 新增 | Go 全量 scanner |
| arch-engine/src/scanners/python-scanner.ts | 新增 | Python 全量 scanner |
| arch-engine/src/scanners/registry.ts | 改 | 注册 Go/Python scanner + repo 路由 |
| arch-engine/src/pipeline.ts | 改 | workspace-aware 多根执行 |
| arch-engine/src/paths.ts | 改 | workspace-aware arch dir |
| arch-engine/src/config.ts | 改 | workspace config 校验 |
| arch-engine/src/index.ts | 改 | 导出新类型 + scanners |
| arch-engine/src/scanners/java.ts | 改 | JavaModule 加 repoSlug |
| arch-engine/src/scanners/frontend.ts | 改 | FrontendPackage 加 repoSlug |
| mcp-server/src/ontology-query.ts | 改 | repoCount topology + repo 分组 |
| mcp-server/src/impact-query.ts | 改 | 跨 repo 边标注 |
| mcp-server/src/ontology/types.ts | 改 | OntologyTopology repoCount |
| arch-engine/tests/ | 新增 | go/python/workspace/pipeline 测试 |

### 1.5 风险与未决项

1. **跨 repo 边误报**：多 repo 共享相同 API path（如 /api/users）时，影响链匹配可能产生伪边。采用 repoSlug 限定匹配范围作为缓解。
2. **Python 缩进解析鲁棒性**：缩进式语法的调用边提取依赖缩进块对齐，Tab/空格混用需容错。scanner 设计为 best-effort + skip 降级。
3. **pipeline 改造复杂度**：runStartInit 是核心函数（约 450 行），workspace 分支需在最小侵入点插入，保持单仓库路径零改动。
4. **增量扫描锚点**：LastScanState.repos 需与现有 modules/packages 记录并存，单仓库模式不读 repos 字段（向后兼容）。
---

## Part 2 — 可执行任务清单

> 实现时由 /implement-plan 按 Task 派发子 Agent 串行执行（主 Agent 编排，每 Task 全新上下文 + Task Review Gate）。子 Agent 每 Task 自动 git commit。

### Task 1: types.ts — 新增全部数据模型接口
+ 在 types.ts 新增 WorkspaceRepo / WorkspaceConfig 接口（path/lang/stack/name/slug 字段）
  - **Files:** arch-engine/src/types.ts
+ 新增 GoModule / GoStruct / GoApiEndpoint / GoMethodNode 接口
  - **Files:** arch-engine/src/types.ts
+ 新增 PythonModule / PythonClass / PythonApiEndpoint / PythonMethodNode 接口
  - **Files:** arch-engine/src/types.ts
+ JavaModule 加 repoSlug（可选）；FrontendPackage 加 repoSlug（可选）
  - **Files:** arch-engine/src/types.ts
+ DocumentModel 加 workspace 字段；LastScanState 加 repos 增量锚点字段
  - **Files:** arch-engine/src/types.ts
  - **Verify:** cd arch-engine; node node_modules/typescript/bin/tsc --noEmit

### Task 2: proto-scanner.ts — 共享 .proto 解析
+ 新增 scanners/proto-scanner.ts，导出 scanProtoServices(repoRoot)，返回 ProtoService 数组
  - **Files:** arch-engine/src/scanners/proto-scanner.ts
+ 正则提取 service X { rpc Method(Req) returns (Resp); }，返回 { serviceName, rpcs: [{ name, requestType, responseType }] }
  - **Files:** arch-engine/src/scanners/proto-scanner.ts
+ glob 扫描 repoRoot 下所有 *.proto 文件并解析
  - **Files:** arch-engine/src/scanners/proto-scanner.ts
+ 新增 tests/scanners/proto-scanner.test.ts：单 .proto fixture（service + 多 rpc）解析验证
  - **Files:** arch-engine/tests/scanners/proto-scanner.test.ts
  - **Verify:** cd arch-engine; npx vitest run tests/scanners/proto-scanner.test.ts --testTimeout=30000

### Task 3: workspace.ts — 清单加载与初始化
+ 新增 src/workspace.ts，导出 loadWorkspace(projectRoot)，读 apt-workspace.json，无则返回 null
  - **Files:** arch-engine/src/workspace.ts
+ 导出 initWorkspace(projectRoot)，扫描子目录检测 pom.xml/go.mod/pyproject.toml/setup.py/package.json，生成 apt-workspace.json
  - **Files:** arch-engine/src/workspace.ts
+ slug 生成函数：path basename lowercase，非法字符替换为 -
  - **Files:** arch-engine/src/workspace.ts
+ 导出 resolveRepoRoot(projectRoot, repoPath)，拼绝对路径
  - **Files:** arch-engine/src/workspace.ts
+ 新增 tests/workspace.test.ts：加载已有清单 / 无清单返回 null / initWorkspace 生成 / slug 规则
  - **Files:** arch-engine/tests/workspace.test.ts
  - **Verify:** cd arch-engine; npx vitest run tests/workspace.test.ts --testTimeout=30000

### Task 4: go-scanner.ts — Go 全量 scanner
+ 新增 scanners/go-scanner.ts，导出 scanGoSources(repoRoot, repoSlug)
  - **Files:** arch-engine/src/scanners/go-scanner.ts
+ 模块发现：扫 go.mod 提取 module name；扫目录树找 go 文件
  - **Files:** arch-engine/src/scanners/go-scanner.ts
+ HTTP API 提取（gin/echo/chi/net-http 四框架正则）转 GoApiEndpoint
  - **Files:** arch-engine/src/scanners/go-scanner.ts
+ gRPC：调 proto-scanner.ts scanProtoServices 转 framework grpc 的 GoApiEndpoint
  - **Files:** arch-engine/src/scanners/go-scanner.ts
+ Struct 实体提取（type X struct）+ json tag 转 GoStruct
  - **Files:** arch-engine/src/scanners/go-scanner.ts
+ 函数定义（func receiver method）转 GoMethodNode；调用边（receiver.method 分类）转 CallGraphEdge
  - **Files:** arch-engine/src/scanners/go-scanner.ts
+ 新增 tests/scanners/go-scanner.test.ts：gin 路由 + struct + 函数调用 fixture
  - **Files:** arch-engine/tests/scanners/go-scanner.test.ts
  - **Verify:** cd arch-engine; npx vitest run tests/scanners/go-scanner.test.ts --testTimeout=30000

### Task 5: python-scanner.ts — Python 全量 scanner
+ 新增 scanners/python-scanner.ts，导出 scanPythonSources(repoRoot, repoSlug)
  - **Files:** arch-engine/src/scanners/python-scanner.ts
+ 模块发现：pyproject.toml project name / setup.py setup(name=) / 目录名
  - **Files:** arch-engine/src/scanners/python-scanner.ts
+ HTTP API 提取（FastAPI/Flask/Django/Tornado 四框架正则）转 PythonApiEndpoint
  - **Files:** arch-engine/src/scanners/python-scanner.ts
+ gRPC：调 proto-scanner.ts 转 framework grpc 的 PythonApiEndpoint
  - **Files:** arch-engine/src/scanners/python-scanner.ts
+ ORM 实体提取（SQLAlchemy tablename / Pydantic BaseModel / Django models.Model）转 PythonClass（ormType 标注）
  - **Files:** arch-engine/src/scanners/python-scanner.ts
+ 函数定义（def/async def）+ 缩进块调用边（self.method / self.field.method / 裸调用）转 PythonMethodNode + CallGraphEdge
  - **Files:** arch-engine/src/scanners/python-scanner.ts
+ 新增 tests/scanners/python-scanner.test.ts：FastAPI 路由 + SQLAlchemy 实体 + Pydantic + 函数调用 fixture
  - **Files:** arch-engine/tests/scanners/python-scanner.test.ts
  - **Verify:** cd arch-engine; npx vitest run tests/scanners/python-scanner.test.ts --testTimeout=30000
### Task 6: java.ts + frontend.ts — repoSlug 字段
+ scanJavaSources 调用链中 JavaModule 写入 repoSlug（默认 undefined/单仓库）
  - **Files:** arch-engine/src/scanners/java.ts
+ scanFrontend 调用链中 FrontendPackage 写入 repoSlug（默认 undefined/单仓库）
  - **Files:** arch-engine/src/scanners/frontend.ts
  - **Verify:** cd arch-engine; node node_modules/typescript/bin/tsc --noEmit

### Task 7: registry.ts — Go/Python scanner 注册 + repo 路由
+ ScannerContext 加 repoSlug 与 repoLang 可选字段
  - **Files:** arch-engine/src/scanners/registry.ts
+ 注册 go-scanner 插件（ctx.repoLang 为 go 时执行 entity + flow + call-graph 三合一）
  - **Files:** arch-engine/src/scanners/registry.ts
+ 注册 python-scanner 插件（ctx.repoLang 为 python 时执行）
  - **Files:** arch-engine/src/scanners/registry.ts
  - **Verify:** cd arch-engine; node node_modules/typescript/bin/tsc --noEmit

### Task 8: paths.ts + config.ts — workspace 感知
+ paths.ts 新增 getArchBackendRepoDir(projectRoot, repoSlug)，多仓库模式 .ai/arch/backend/repo-slug/
  - **Files:** arch-engine/src/paths.ts
+ config.ts 新增 workspace config 校验（apt-workspace.json repos 格式校验，lang 合法值检查）
  - **Files:** arch-engine/src/config.ts
  - **Verify:** cd arch-engine; node node_modules/typescript/bin/tsc --noEmit

### Task 9: pipeline.ts — workspace-aware 多根执行
+ runStartInit 开头调 loadWorkspace(projectRoot)；null 则走原有单仓库逻辑零改动
  - **Files:** arch-engine/src/pipeline.ts
+ workspace 模式：遍历 repos，按 lang 分发（java / go / python / ts 各走对应 scanner）
  - **Files:** arch-engine/src/pipeline.ts
+ 合并所有 repo 结果到统一 DocumentModel（apis/rpcs/modules/packages/entities/flows/callGraph 含 repoSlug）
  - **Files:** arch-engine/src/pipeline.ts
+ 跨 repo 边检测：合并统一 API+RPC 索引后，检测 call-graph 中跨 repo 引用，创建 crossRepo 边
  - **Files:** arch-engine/src/pipeline.ts
+ 增量扫描：LastScanState.repos 按 repo 独立追踪 commit，无变更 repo 跳过重扫
  - **Files:** arch-engine/src/pipeline.ts
+ 写入 workspace 级 .ai/arch（路径含 repo-slug 命名层）
  - **Files:** arch-engine/src/pipeline.ts
+ 新增 tests/pipeline-workspace.test.ts：多 repo fixture（1 Java + 1 Go + 1 Python）集成扫描
  - **Files:** arch-engine/tests/pipeline-workspace.test.ts
  - **Verify:** cd arch-engine; npx vitest run tests/pipeline-workspace.test.ts --testTimeout=30000

### Task 10: index.ts — 导出新类型与 scanner
+ 导出 WorkspaceRepo/WorkspaceConfig/Go/Python 类型
  - **Files:** arch-engine/src/index.ts
+ 导出 loadWorkspace/initWorkspace/resolveRepoRoot
  - **Files:** arch-engine/src/index.ts
+ 导出 scanGoSources/scanPythonSources/scanProtoServices
  - **Files:** arch-engine/src/index.ts
  - **Verify:** cd arch-engine; node node_modules/typescript/bin/tsc --noEmit

### Task 11: mcp-server — ontology 多 repo 感知
+ OntologyTopology 加 repoCount 可选字段
  - **Files:** mcp-server/src/ontology/types.ts
+ handleQueryOntology topology 计算 repoCount（workspace 模式 = repos.length，单仓库省略）
  - **Files:** mcp-server/src/ontology-query.ts
+ modules 列表含 repoSlug，按 repo 分组展示
  - **Files:** mcp-server/src/ontology-query.ts
+ 新增 tests/ontology-workspace.test.ts：多 repo topology + repo 分组
  - **Files:** mcp-server/tests/ontology-workspace.test.ts
  - **Verify:** cd mcp-server; npx vitest run tests/ontology-workspace.test.ts --testTimeout=30000

### Task 12: mcp-server — impact 跨 repo 边标注
+ handleQueryImpact 检测影响链中跨 repo 节点，返回结果标注 crossRepo true
  - **Files:** mcp-server/src/impact-query.ts
+ 跨 repo 节点的 moduleSlug 变为 repo-slug/module-slug 格式
  - **Files:** mcp-server/src/impact-query.ts
+ 新增 tests/impact-cross-repo.test.ts：跨 repo 影响链 fixture
  - **Files:** mcp-server/tests/impact-cross-repo.test.ts
  - **Verify:** cd mcp-server; npx vitest run tests/impact-cross-repo.test.ts --testTimeout=30000

### Task 13: 全量集成测试 + 编译验证
+ arch-engine 全量 tsc 编译通过
  - **Verify:** cd arch-engine; node node_modules/typescript/bin/tsc --noEmit
+ mcp-server 全量 tsc 编译通过
  - **Verify:** cd mcp-server; node node_modules/typescript/bin/tsc --noEmit
+ arch-engine 全量测试通过
  - **Verify:** cd arch-engine; npx vitest run --testTimeout=30000
+ mcp-server 全量测试通过
  - **Verify:** cd mcp-server; npx vitest run --testTimeout=30000
+ 单仓库回归：确认无 apt-workspace.json 时行为与 v2.0.6 一致（现有测试全绿）
  - **Verify:** cd arch-engine; npx vitest run --testTimeout=30000
