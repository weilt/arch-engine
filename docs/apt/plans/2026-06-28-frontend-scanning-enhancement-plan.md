# Frontend Scanning Enhancement (v2.0.1) Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-06-28-frontend-scanning-enhancement-design.md`
> **Command:** `/plan-from-spec`
> **Status:** approved

**Goal:** 让 arch-engine 前端扫描器从「扁平 component/util/enum」升级为「契约感知」模型，登记真实 Vue 3 / React 项目的 API-client / 路由 / store / 组件契约，且可被 `query_arch` / `search_arch` 检索。

**Architecture:** 在 `scanPackageDir` 文件遍历内新增正则语义提取 pass（与 `discoverExports` 并行、不替换）；新增三个 `AssetKind`（`api-client`/`route`/`store`）+ 三个契约结构 + 四个纯函数提取器模块；Tier 1 修 P0-1/P0-2/P1/P2 基线 bug。全程正则无 AST，沿用 `ts-doc.ts` 风格；后端 Java 扫描器与设计层不动，16 个 MCP 工具签名不变。

---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束

**范围内（spec §1.1）：**

- Tier 1：P0-1（`<script setup>` 识别）、P0-2（`.js` glob）、P1（新包增量盲区）、P2（非 JS 根模块发现）
- Tier 2：4 个语义提取器（`frontend-api.ts` / `frontend-router.ts` / `frontend-store.ts` / `frontend-vue-contract.ts`）+ 3 个 `AssetKind` + 3 个契约结构 + writer 三 section + ArchChunk.kind 联合扩展

**非目标（spec §1.2）：**

- 后端语言扩展（Python/C#/Go/Rust）— 后续版本
- AST 解析 — 全程正则
- 新增 UI 框架（Svelte/Solid/Angular）
- 设计层（bindings/css-tokens/figma）改动
- MCP 工具新增/改名（仍是 16 工具）

**无前端 UI** — 本功能为扫描器 + 类型 + writer 内核扩展，无用户界面。设计寻址 N/A（spec §1.2）。

### 1.2 设计寻址（无 UI 则写 N/A）

N/A — 本功能为 arch-engine 扫描器内核扩展，全程无前端 UI（spec §1.2、§3.6）。`.ai/design/` 知识层不消费。

### 1.3 依赖寻址表

> **寻址说明：** 本仓库 `.ai/arch/` 索引仅含扫描目标（Java fixtures），**未索引 arch-engine 自身 TS**（arch-engine 是扫描工具，不自举）。已实测：`query_contract(FrontendPackage)` / `query_contract(AssetKind)` 均返回 `Contract not found`；`search_arch("discoverExports scanPackageDir frontend scanner source")` 与 `search_arch("extractFromSource extractVueScript")` 仅返回 Java fixtures（弱相关，score ~0.38–0.48），无 arch-engine TS 资产。此为与已批准的 `2026-06-25-apt-2.0-autonomous-loop-plan.md`、`2026-06-22-apt-verify-command-plan.md` 同模式：扫描器代码扩展任务以 **sourcePath + 行号** 为真源，不调用 `report_missing`（依赖实际存在，仅未自举入索引）。下表行号均已逐文件核实。

| 依赖 | 来源 | 引用（sourcePath） | 摘要 |
|------|------|---------------------|------|
| `AssetKind` 联合 | 源码 | `arch-engine/src/types.ts:62` | 当前 8 成员联合（api/rpc/component/util/enum/starter/pojo/contract）；+3 新成员 `api-client`/`route`/`store` |
| `FrontendPackage` | 源码 | `arch-engine/src/types.ts:37` | `{ slug, name, description, framework?, components, utils, enums }`；+3 可选数组 `apiClients?/routes?/stores?` |
| `ApiClientContract`/`RouteEntry`/`StoreContract` | spec（真源） | spec §3.2 | 3 新契约结构（spec 已给完整字段定义，types.ts 新增） |
| `ArchChunk.kind` 联合 | 源码 | `arch-engine/src/types.ts:98` | chunk kind 联合，+3 新成员同步进向量库 |
| `discoverExports` | 源码（contract） | `arch-engine/src/scanners/ts-export.ts:53` | `discoverExports(fileContent, filePath): DiscoveredExport[]`；P0-1 兜底在此文件末尾（含失效的 `<script` 检测，约 L88-95） |
| `ExportKindHint`/`DiscoveredExport` | 源码 | `arch-engine/src/scanners/ts-export.ts:1,5` | `"component"\|"util"\|"enum"`；提取器 hint 信号 |
| `extractFromSource`/`extractVueScript` | 源码（contract） | `arch-engine/src/scanners/ts-doc.ts:57,130` | `extractFromSource(content, fileBaseName)` 返回 `{description,exports,enums}`；`extractVueScript(content)` 剥离 `<script>` 标签（P0-1 根因：调用方传剥离后 content 给 discoverExports） |
| `SOURCE_GLOBS` | 源码 | `arch-engine/src/scanners/frontend.ts:22` | `["src/**/*.{ts,tsx,vue}"]`（P0-2 根因，不含 `.js/.jsx/.mjs`） |
| `scanPackageDir` | 源码（contract） | `arch-engine/src/scanners/frontend.ts:184` | `(projectRoot, pkgDir) => FrontendPackage|null`；文件循环 L193+，加语义 pass 处 |
| `scanFrontend` | 源码 | `arch-engine/src/scanners/frontend.ts:270` | workspace 包发现入口 |
| `getWorkspacePatterns`/`inferFramework` | 源码 | `arch-engine/src/scanners/frontend.ts:33,57` | P2 复用：仅认 pnpm-workspace/root package.json workspaces（P2 根因）；inferFramework 已识别 vue/react |
| `readSourceContent`/`collectSourceFiles` | 源码 | `arch-engine/src/scanners/frontend.ts:64,70` | `.vue` 走 `extractVueScript` 剥离（P0-1 根因）；collectSourceFiles 用 SOURCE_GLOBS（P0-2） |
| `runStartInit`/增量分支 | 源码（contract） | `arch-engine/src/pipeline.ts:322` | `let incremental` L348、`affectedPackages` L350/402/411、`packagesToProcess` L435；P1 修复点（新包加入 affected） |
| `resolveFrontendPackageDirs` | 源码 | `arch-engine/src/pipeline.ts:138` | workspace → pkgDir map；P2 配置 `frontendPackages` + 非 JS 根自动发现注入处 |
| `mapFilesToPackages`/`getChangedFilesSince` | 源码 | `arch-engine/src/incremental/git-diff.ts:113,72` | git diff → affected packages；P1 用 |
| `DEFAULT_CONFIG`/`ArchConfig` | 源码（contract） | `arch-engine/src/config.ts:6` + types.ts `ArchConfig` | `scanners:{java,frontend}`；+`frontendPackages?: string[]` |
| `writeModuleAssetDocs`/`writeMarkdownTree` | 源码（contract） | `arch-engine/src/writer/asset-md.ts:82`、`markdown.ts:137` | 资产文档渲染入口；+3 section（api-clients/routes/stores） |

**未命中处理：** 无。所有依赖均已定位到 sourcePath + 行号或 spec 章节；不存在需 `report_missing` 阻塞的缺失项（arch 索引未自举属预期，见上方寻址说明）。

### 1.4 拟改动模块与文件

| 文件/模块 | 变更类型 | 说明 | Tier |
|-----------|----------|------|------|
| `arch-engine/src/types.ts` | 修改 | `AssetKind` +3 成员；`FrontendPackage` +3 可选数组；`ArchChunk.kind` +3；新增 `ApiClientContract`/`RouteEntry`/`StoreContract` | 2 |
| `arch-engine/src/scanners/frontend-api.ts` | 新增 | `extractApiClients(content, filePath)` + `isApiClientFile` | 2 |
| `arch-engine/src/scanners/frontend-router.ts` | 新增 | `extractRoutes(content)` + `isRouterFile` | 2 |
| `arch-engine/src/scanners/frontend-store.ts` | 新增 | `extractStores(content)` + `isStoreFile` | 2 |
| `arch-engine/src/scanners/frontend-vue-contract.ts` | 新增 | `extractVueContract(rawSfc)`（P0-1 修复用原始 SFC） | 2 |
| `arch-engine/src/scanners/ts-export.ts` | 修改 | P0-1 兜底：`filePath.toLowerCase().endsWith(".vue")` 为 SFC 信号 | 1 |
| `arch-engine/src/scanners/frontend.ts` | 修改 | SOURCE_GLOBS 扩 `.js/.jsx/.mjs`（P0-2）；`scanPackageDir` 加语义 pass；`getWorkspacePatterns` 加非 JS 根自动发现 + `frontendPackages` 配置优先（P2） | 1+2 |
| `arch-engine/src/config.ts` | 修改 | `DEFAULT_CONFIG` 加 `frontendPackages: []` | 1 |
| `arch-engine/src/pipeline.ts` | 修改 | 增量模式新包加入 `affectedPackages`（P1）；`resolveFrontendPackageDirs` 消费 `frontendPackages`（P2） | 1 |
| `arch-engine/src/writer/asset-md.ts` | 修改 | +3 section 渲染（api-clients/routes/stores） | 2 |
| `arch-engine/src/asset/chunks-from-cards.ts` | 修改 | 新 AssetKind → chunk kind 映射 | 2 |
| `arch-engine/tests/scanners/frontend-api.test.ts` | 新增 | extractApiClients 单测 | 2 |
| `arch-engine/tests/scanners/frontend-router.test.ts` | 新增 | extractRoutes 单测 | 2 |
| `arch-engine/tests/scanners/frontend-store.test.ts` | 新增 | extractStores 单测 | 2 |
| `arch-engine/tests/scanners/frontend-vue-contract.test.ts` | 新增 | extractVueContract 单测 | 2 |
| `arch-engine/tests/scanners/ts-export.test.ts` | 新增 | P0-1 修复单测（`<script setup>` 无 defineProps → 仍登记 component） | 1 |
| `arch-engine/tests/scanners/frontend.test.ts` | 新增/修改 | `scanPackageDir` 集成（preaudit-web fixture 断言 apiClients/routes/stores 非空）+ P0-2/.js 遍历单测 | 1+2 |
| `arch-engine/tests/pipeline.test.ts`（或 incremental 用例） | 新增 | P1 新包增量用例 | 1 |

**不改动：** 后端 scanners（`java*.ts`）、设计层（`design/*`）、MCP `mcp-server/src/index.ts` 工具签名、`incremental/git-diff.ts` 核心（仅 import）、`asset/id.ts`、`chunking/*`、`embedding/*`、`vector/*`。

### 1.5 风险与未决项

| 风险 | 缓解 |
|------|------|
| `AssetKind` 扩展触及多文件（types/chunks-from-cards/writer/MCP 消费点） | 联合扩展是加法；`cd arch-engine && npm run build`（tsc）会标出所有遗漏消费点，Task 2 Verify 锁定编译通过 |
| 正则提取器对非标准 idiom（手写 fetch、复杂嵌套路由）覆盖不全 | 仅捕获常见 idiom（axios/request 实例、createRouter、defineStore）；LLM summarize 阶段补全；长尾留后续版本 |
| 非 JS 根自动发现误纳入（monorepo 工具包） | 仅扫根直接子目录 + 必须有前端依赖（vue/react，复用 inferFramework）+ 可被 `frontendPackages` 显式覆盖 |
| 模板路径（`/user/${id}`）与后端 path 对齐 | 原样保留 string；对齐留作 `query_arch` 文本检索，不做硬链接 |
| Vue `<template>` 标签抽取含 HTML 原生标签（div/span） | 过滤 HTML 白名单，仅留 PascalCase / 库前缀（el-/a-/van-）组件 |
| P1「新包增量」与既有增量 fallback 路径交互 | 增量分支已有 git diff 失败 fallback（pipeline.ts L414-428）；新包注入仅加 Set，不破坏 fallback |

**无需回填 spec：** spec §3 技术方案与 §6 文件清单与本 plan 一致，无冲突。

---

## Part 2 — 可执行任务清单

> 串行 Gate：Tier 1（Task 1–4）先修基线 bug，Tier 2（Task 5–9）再扩展语义提取；每 Task Review Gate 通过才进下一个。子 Agent 每 Task 自动 `git commit`。

### Task 1: types.ts 类型扩展（Tier 2 基础，先行避免编译断裂）

- [ ] `arch-engine/src/types.ts`：`AssetKind` 联合 +3 成员 `"api-client" | "route" | "store"`（types.ts:62）
- [ ] `FrontendPackage`（types.ts:37）加 3 可选数组：`apiClients?: ApiClientContract[]; routes?: RouteEntry[]; stores?: StoreContract[]`
- [ ] `ArchChunk.kind`（types.ts:98）联合 +3 成员
- [ ] 新增 `ApiClientContract` / `RouteEntry` / `StoreContract` 三个 interface（字段见 spec §3.2）
  - **MCP:** `query_arch` path=`arch-engine/src/types.ts`（类型定义范式）；spec §3.2
  - **Files:** `arch-engine/src/types.ts`
  - **Verify:** `cd arch-engine && node node_modules/typescript/bin/tsc --noEmit`（编译通过；此时下游消费点可能因新联合成员报缺漏，留 Task 5/7 修，**本 Task 允许下游消费点 warning，但 types.ts 自身无错**）

### Task 2: config.ts + Tier 1 P2 配置项

- [ ] `arch-engine/src/config.ts`：`DEFAULT_CONFIG`（config.ts:6）加 `frontendPackages: []`
- [ ] `arch-engine/src/types.ts`：`ArchConfig` 加 `frontendPackages?: string[]`
  - **MCP:** `query_arch` path=`arch-engine/src/config.ts`（DEFAULT_CONFIG 范式 L6）
  - **Files:** `arch-engine/src/config.ts`, `arch-engine/src/types.ts`
  - **Verify:** `cd arch-engine && node node_modules/typescript/bin/tsc --noEmit`

### Task 3: P0-1 修复 — `<script setup>` 组件识别（ts-export.ts + frontend-vue-contract）

- [ ] `arch-engine/src/scanners/ts-export.ts`：`discoverExports`（ts-export.ts:53）末尾 P0-1 兜底改为 `filePath.toLowerCase().endsWith(".vue")` 为 SFC 信号（不再在剥离后 content 上检测 `<script`）
- [ ] `arch-engine/src/scanners/frontend-vue-contract.ts` 新增：`extractVueContract(rawSfc: string): { isComponent: boolean; props: string[]; emits: string[]; templateTags: string[] } | null`，用**原始** SFC 文本（非剥离后）
  - 抽 `<script setup>` 的 `defineProps<{...}>()` / `defineProps({...})` / `withDefaults` / `defineEmits<...>()` / `defineModel` → props 字段名、emit 事件名
  - 从 `<template>` 抽组件标签（`<el-card>`/`<UserWidget>`），过滤 HTML 白名单，仅留 PascalCase / 库前缀（el-/a-/van-）
  - **MCP:** spec §3.3 Vue 契约；`ts-doc.ts:130` extractVueScript（剥离后 content 的 P0-1 根因对照）
  - **Files:** `arch-engine/src/scanners/ts-export.ts`, `arch-engine/src/scanners/frontend-vue-contract.ts`
- [ ] `arch-engine/tests/scanners/ts-export.test.ts` 新增：`<script setup>` 无 defineProps → 仍登记 component；原始 SFC 入参
- [ ] `arch-engine/tests/scanners/frontend-vue-contract.test.ts` 新增：`<script setup>`+defineProps+emits、无脚本 SFC、Options API defineComponent、templateTags 抽取
  - **Verify:** `cd arch-engine && npx vitest run tests/scanners/ts-export.test.ts tests/scanners/frontend-vue-contract.test.ts`

### Task 4: P0-2 + P1 + P2 修复 — glob 扩展、新包增量、非 JS 根发现

- [ ] `arch-engine/src/scanners/frontend.ts`：`SOURCE_GLOBS`（frontend.ts:22）扩为 `["src/**/*.{ts,tsx,js,jsx,mjs,vue}"]`
- [ ] `arch-engine/src/scanners/frontend.ts`：`getWorkspacePatterns`（frontend.ts:33）加非 JS 根自动发现 — workspace 探测为空且根无 `package.json` 时，扫根直接子目录里含 `package.json` 且有前端依赖（复用 `inferFramework` frontend.ts:57）的目录；探测为空时日志明确提示（避免静默成功）
- [ ] `arch-engine/src/pipeline.ts`：`resolveFrontendPackageDirs`（pipeline.ts:138）优先读 `config.frontendPackages`（Task 2 配置项），绕过 workspace 探测
- [ ] `arch-engine/src/pipeline.ts`：增量分支（pipeline.ts:402 附近）把「本次发现但 `previousScan.packages` 里没有的新包」自动加入 `affectedPackages`（backend modules 同理加一道）
  - **MCP:** spec §3.5；`git-diff.ts:113` mapFilesToPackages（P1 上下文）
  - **Files:** `arch-engine/src/scanners/frontend.ts`, `arch-engine/src/pipeline.ts`
- [ ] `arch-engine/tests/scanners/frontend.test.ts` 新增：`.js` 文件被 collectSourceFiles 遍历；非 JS 根自动发现子目录含前端依赖
- [ ] `arch-engine/tests/pipeline.test.ts`（或 incremental 用例）新增：新包不在 previousScan → 自动入 affectedPackages
  - **Verify:** `cd arch-engine && npx vitest run tests/scanners/frontend.test.ts tests/pipeline.test.ts`；无对应文件则跑全量 `npx vitest run`
  - **Note:** 子 Agent 若需在仓库内 dogfood 验证（`preaudit-web` fixture），用临时 tmpRoot，**禁止**改 `D:/software/preaudit` 或 `.ai/arch/`

### Task 5: frontend-api.ts 提取器 + ts-export 消费点（Tier 2 开始）

- [ ] `arch-engine/src/scanners/frontend-api.ts` 新增：`extractApiClients(content: string, filePath: string): ApiClientContract[]` + `isApiClientFile(content: string): boolean`
  - 触发：`import .* from .*request` / `from 'axios'` / `require('axios')` 且含 `.get/.post/.put/.delete/.patch(`
  - 扫调用 `.method('/path'` 或 `.method(\`/path\``，第一个 string/template-literal 参数；模板路径原样保留
  - 导出名优先 `export const X = {...}` 的 `X`，否则文件基名
- [ ] `arch-engine/src/scanners/frontend.ts`：`scanPackageDir`（frontend.ts:184）文件循环加 `if (isApiClientFile(content)) apiClients.push(...extractApiClients(content, relativeFile))`
- [ ] `arch-engine/src/asset/chunks-from-cards.ts`：新 `api-client` kind → chunk kind 映射（若此处枚举所有 kind）
  - **MCP:** spec §3.3 API-client；`frontend.ts:184` scanPackageDir（消费处）
  - **Files:** `arch-engine/src/scanners/frontend-api.ts`, `arch-engine/src/scanners/frontend.ts`, `arch-engine/src/asset/chunks-from-cards.ts`
- [ ] `arch-engine/tests/scanners/frontend-api.test.ts` 新增：axios 实例调用、模板路径 `${id}`、无调用返回空、导出名优先
  - **Verify:** `cd arch-engine && npx vitest run tests/scanners/frontend-api.test.ts`

### Task 6: frontend-router.ts 提取器

- [ ] `arch-engine/src/scanners/frontend-router.ts` 新增：`extractRoutes(content: string): RouteEntry[]` + `isRouterFile(content: string): boolean`
  - 触发：`createRouter` / `new VueRouter` / `new Router(` / React `<Route`
  - 遍历 `routes` 数组项；嵌套 `children:` 拍平，子 path 与父 path 拼接
  - `meta` 宽松正则提 `{ ... }` 块，保留 title/icon/hidden/noAuth
- [ ] `arch-engine/src/scanners/frontend.ts`：`scanPackageDir` 加 `if (isRouterFile(content)) routes.push(...extractRoutes(content))`
  - **MCP:** spec §3.3 router；`frontend.ts:184` scanPackageDir
  - **Files:** `arch-engine/src/scanners/frontend-router.ts`, `arch-engine/src/scanners/frontend.ts`
- [ ] `arch-engine/tests/scanners/frontend-router.test.ts` 新增：vue-router createRouter + children 嵌套拍平、meta 提取、React `<Route`、无 routes 返回空
  - **Verify:** `cd arch-engine && npx vitest run tests/scanners/frontend-router.test.ts`

### Task 7: frontend-store.ts 提取器

- [ ] `arch-engine/src/scanners/frontend-store.ts` 新增：`extractStores(content: string): StoreContract[]` + `isStoreFile(content: string): boolean`
  - 触发：`defineStore(` / `new Vuex.Store(` / `createStore(`
  - Pinia setup-store：取 store id（`defineStore('user', ...)`），从 `return {...}` 抽导出键分 state/getters/actions（启发式：`ref/computed` → state/getter，`function` → action）
  - Vuex：取 `state`/`getters`/`actions`/`mutations` 四键集合
- [ ] `arch-engine/src/scanners/frontend.ts`：`scanPackageDir` 加 `if (isStoreFile(content)) stores.push(...extractStores(content))`
  - **MCP:** spec §3.3 store；`frontend.ts:184` scanPackageDir
  - **Files:** `arch-engine/src/scanners/frontend-store.ts`, `arch-engine/src/scanners/frontend.ts`
- [ ] `arch-engine/tests/scanners/frontend-store.test.ts` 新增：Pinia setup return keys、Vuex 四键集合、defineStore 无 return
  - **Verify:** `cd arch-engine && npx vitest run tests/scanners/frontend-store.test.ts`

### Task 8: writer 三 section 渲染 + 组件 related 回填

- [ ] `arch-engine/src/writer/asset-md.ts`：`writeModuleAssetDocs`（asset-md.ts:82）+3 section 渲染（`api-clients.md` / `routes.md` / `stores.md`），按 `FrontendPackage.apiClients/routes/stores` 渲染；与现有 `components.md`/`utils.md` 并列
- [ ] `arch-engine/src/scanners/frontend.ts`：`.vue` 文件在 component 卡 push 后，调 `extractVueContract(rawSfc)` 回填该 component 卡的 `related`（templateTags）+ `signatures`（props/emits）
  - **MCP:** spec §3.6；`asset-md.ts:82` writeModuleAssetDocs
  - **Files:** `arch-engine/src/writer/asset-md.ts`, `arch-engine/src/scanners/frontend.ts`
  - **Verify:** `cd arch-engine && node node_modules/typescript/bin/tsc --noEmit`；用 preaudit-web fixture 临时 tmpRoot 跑 `runStartInit` 断言生成 `api-clients.md`/`routes.md`/`stores.md`

### Task 9: scanPackageDir 集成 + 全量回归

- [ ] `arch-engine/tests/scanners/frontend.test.ts` 新增 `scanPackageDir` 端到端：用 preaudit-web 风格 fixture（`api/*.js` + `router/index.js` + `stores/*.js` + `<script setup>` `.vue`）断言 `apiClients/routes/stores` 非空、component 卡 `related` 非空
- [ ] 全量回归：`cd arch-engine && npx vitest run`（当前 181/181，须全绿，新测试计入）
- [ ] `cd arch-engine && node node_modules/typescript/bin/tsc --noEmit` 编译通过
  - **MCP:** spec §8 成功标准（components ≥ 11、api-clients ≥ 5、routes ≥ 1、stores ≥ 1）
  - **Files:** `arch-engine/tests/scanners/frontend.test.ts`
  - **Verify:** `cd arch-engine && npx vitest run`（全量绿）+ `tsc --noEmit`

### Task 10: 闭环（主 Agent 执行，非子 Agent）

- [ ] 对 `ApiClientContract` / `RouteEntry` / `StoreContract` → `register_contract`（`tsFilePath: arch-engine/src/types.ts`）
- [ ] `audit_arch_changes`（只读）— 预期仍空（arch-engine 不自举）
- [ ] 运行 `cd arch-engine && npx vitest run` 最终确认
  - **MCP:** `query_contract` name=`ApiClientContract`（确认未登记）→ `register_contract`
  - **Files:** `.ai/db.json`（由 register 写入，非手改）

---

**实现后验收：** plan Status 改 `approved` 后，使用 `/verify docs/apt/plans/2026-06-28-frontend-scanning-enhancement-plan.md` 对照本 Part 2 任务清单验收。
**成功标准：** spec §8（preaudit-web 全量扫描 components ≥ 11、api-clients ≥ 5、routes ≥ 1、stores ≥ 1；`query_arch path=frontend/preaudit-web/api-client#userApi` 命中；vitest 全绿）。
**禁止：** 改后端 Java scanners / 设计层 / MCP 工具签名；改 `D:/software/preaudit` 或本仓库 `.ai/arch/`（dogfood 用临时 tmpRoot）。
