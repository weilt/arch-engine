# Frontend Scanning Enhancement (v2.0.1) — Design Spec

> **Version:** 2.0.1
> **Scope:** arch-engine 前端扫描能力增强（后端/Java 不动）
> **来源诊断:** `D:/software/preaudit/docs/arch-engine-frontend-scanning-report.md`（P0-1/P0-2/P1/P2）
> **状态:** draft（待用户确认）
> **日期:** 2026-06-28

## 1. 目标与非目标

### 1.1 目标

让 arch-engine 前端扫描器从「扁平的 component/util/enum 列表」升级为「契约感知」模型，能登记真实 Vue 3 / React 项目的高价值前端资产，且可被 `query_arch` / `search_arch` 检索。

两层工作：

- **Tier 1（基线修复）**：修复诊断报告的 P0-1/P0-2/P1/P2，让现有扫描器真正工作。
- **Tier 2（语义契约提取）**：新增 API-client / router / store 提取器与 Vue 组件契约增强，让前端资产携带结构化签名而非被压扁为 `util`。

### 1.2 非目标

- 后端语言扩展（Python/C#/Go/Rust）— 留待后续版本。
- AST 解析（Babel/acorn/vue-template-compiler）— 全程正则，沿用 `ts-doc.ts` 风格。
- 新增 UI 框架支持（Svelte/Solid/Angular）— 先把 Vue/React 扫描做对。
- 设计层（bindings/css-tokens/figma）改动 — 设计层不变。
- MCP 工具新增/改名 — 16 个 MCP 工具不变，仅 `query_arch`/`search_arch` 返回内容更丰富。

## 2. 现状诊断（实证基线）

来源项目 `preaudit-web`（Vue 3 + Vite + Element Plus，11 `.vue` + 8 `.js` + 4 `.ts` spec）。实测全量扫描 `packages: 1` 被发现，但前端资产贡献为 0：

| 问题 | 级别 | 影响 |
|------|------|------|
| P0-1 `<script setup>` 组件识别失败 | 阻塞 | 11 个 `.vue` 全部 0 命中（兜底逻辑在剥离后的 content 上检测 `<script`，永假） |
| P0-2 `.js` 被 glob 硬排除 | 阻塞 | API/路由/store/入口（8 个 `.js`）全部丢失 |
| P1 增量扫描对新包盲区 | 高 | 首次纳入的前端包「静默成功但内容为空」，须 `--full` |
| P2 非 JS 根项目模块发现不友好 | 中 | 前端工程嵌套在 Java/Go/Python 根下默认不可见 |
| **P3「扁平化为 util」**（报告之外）| 高 | 即便修好 P0-1/P0-2，API 客户端/路由表/store 仍被压扁为单个无意义 `util` 卡片，HTTP 方法+路径、路由→组件映射、状态接口全部丢失 |

`preaudit-web` 真实前端拥有的、当前不可见的高价值契约：

- `api/user.js` → `userApi = { login: POST /user/login, list: GET /user/list, delete: DELETE /user/${id} }`（前后端联调最关键的调用面）
- `router/index.js` → `/dashboard → Dashboard.vue (meta: 仪表盘)`，含嵌套 children、`noAuth` 守卫
- `stores/user.js` → Pinia store `{ token, userInfo, isLoggedIn, username, login(), logout() }`
- `Dashboard.vue` → 依赖 `statsApi`/`mappingApi`/`VChart`/`<el-card>`（组件→依赖链当前为零）

## 3. 技术方案

### 3.1 架构：提取器注册表（纯函数，无 AST）

在 `scanPackageDir` 的文件遍历内新增**语义提取 pass**，与现有 `discoverExports` 并行，而非替换。每文件按触发条件优先级运行提取器，首个命中产出该类卡片；`.vue` 组件契约增强在已有 component 卡片上回填 `related`/`signatures`。

```
package dir
  └─ for each source file (.js/.jsx/.mjs/.ts/.tsx/.vue)
       ├─ existing: discoverExports → component/util/enum hints   (unchanged)
       └─ NEW: semantic extractors（触发条件互斥）
             ├─ api-client     (import request/axios + .get/.post/.put/.delete/.patch 调用)
             ├─ route          (createRouter / new VueRouter / <Route)
             ├─ store          (defineStore / new Vuex.Store / createStore)
             └─ component-contract (.vue SFC — 总是运行，回填 props/emits/templateTags)
```

设计属性：

- **现有检测不动**：语义提取是附加 pass，无语义命中时仍回退到原有扁平 util。
- **提取器纯函数**：均签名为 `extract*(content, filePath)` / `extract*(rawSfc)`，与 `discoverExports` 同形，可单测，无 I/O 耦合。
- **去重**：卡片按 `(kind, name)` 去重；组件增强仅更新已有 component 卡片，不新建。

### 3.2 类型扩展（`arch-engine/src/types.ts`）

`AssetKind` 联合新增三个成员：

```ts
export type AssetKind =
  | "api" | "rpc" | "component" | "util" | "enum" | "starter" | "pojo" | "contract"
  | "api-client" | "route" | "store";   // NEW
```

`FrontendPackage` 新增三个可选数组（与 `components/utils/enums` 并列）：

```ts
export interface FrontendPackage {
  // ...existing...
  apiClients?: ApiClientContract[];
  routes?: RouteEntry[];
  stores?: StoreContract[];
}
```

三个新契约结构：

```ts
export interface ApiClientContract {
  name: string;        // userApi / 文件基名
  file: string;        // api/user.js
  description: string;
  endpoints: { method: "GET"|"POST"|"PUT"|"DELETE"|"PATCH"; path: string }[];
}

export interface RouteEntry {
  path: string;        // /dashboard
  name?: string;       // Dashboard
  component?: string;  // @/views/dashboard/Dashboard.vue
  meta?: Record<string, unknown>;  // { title, icon, hidden, noAuth }
  children?: RouteEntry[];
}

export interface StoreContract {
  name: string;        // useUserStore
  storeId?: string;    // user
  file: string;
  description: string;
  state: string[];
  getters: string[];
  actions: string[];
}
```

`ArchChunk.kind` 与 `index.ts` MCP 的 `AssetKind` 消费点同步增加新成员（writer/markdown 生成各 section）。

### 3.3 新提取器模块（`arch-engine/src/scanners/`）

全部正则，纯函数，与 `ts-doc.ts`/`ts-export.ts` 同风格：

| 模块 | 函数 | 触发 | 产出 |
|------|------|------|------|
| `frontend-api.ts` | `extractApiClients(content, filePath)` | `import .* from .*request` / `from 'axios'` / `require('axios')` 且含 `.get/.post/.put/.delete/.patch(` | `{ name, endpoints: [{method, path}] }`，每文件一卡（如 `userApi`） |
| `frontend-router.ts` | `extractRoutes(content)` | `createRouter` / `new VueRouter` / `new Router(` / `<Route` | 扁平 `{ path, name, component, meta }[]`，children 拼接父 path；每路由文件一卡 |
| `frontend-store.ts` | `extractStores(content)` | `defineStore(` / `new Vuex.Store(` / `createStore(` | `{ name, storeId, state[], getters[], actions[] }`，每 store 一卡 |
| `frontend-vue-contract.ts` | `extractVueContract(rawSfc)` | `.vue` SFC 总运行 | `{ isComponent, props[], emits[], templateTags[] }`；isComponent 见 P0-1 修复 |

提取规则细节：

- **API-client**：扫 `.get|.post|.put|.delete|.patch` + 第一个 string/template-literal 参数。模板路径（`/user/${id}`）原样保留（可解析、可读、后端链接器可处理）。导出名优先取 `export const X = {...}` 的 `X`，否则文件基名。
- **router**：遍历 `routes` 数组项；嵌套 `children:` 拍平，子 path 与父 path 拼接。`meta` 用宽松正则提 `{ ... }` 块，尽量保留 title/icon/hidden/noAuth。
- **store（Pinia setup）**：取 store id（`defineStore('user', ...)`），从 setup `return {...}` 抽导出键。**store（Vuex）**：取 `state`/`getters`/`actions`/`mutations` 四键集合。
- **Vue 契约**：用**原始** SFC 文本（非剥离后），直接修 P0-1；从 `<script setup>` 抽 `defineProps<{...}>()` / `defineProps({...})` / `withDefaults` / `defineEmits<...>()` / `defineModel` → props 字段名、emit 事件名；从 `<template>` 抽组件标签（`<el-card>`/`<el-row>`/`<UserWidget>`）→ 组件卡 `related` 依赖。

### 3.4 数据流变更（`arch-engine/src/scanners/frontend.ts`）

`scanPackageDir` 在现有符号提取后、同一文件循环内新增语义 pass：

```ts
for (const relativeFile of files) {
  // ...existing doc + discoverExports → push component/util/enum (unchanged fallback)

  // NEW semantic pass（触发条件互斥）
  if (isApiClientFile(content))  apiClients.push(...extractApiClients(content, relativeFile));
  if (isRouterFile(content))     routes.push(...extractRoutes(content));
  if (isStoreFile(content))      stores.push(...extractStores(content));
  if (relativeFile.toLowerCase().endsWith(".vue")) {
    // enrich 已有 component 卡片 related/signatures（不新建卡）
    const vc = extractVueContract(rawSfc);
    if (vc) enrichComponentCard(componentCard, vc);
  }
}
```

一文件命中多提取器是可能的（罕见），按 `(kind, name)` 去重接受。组件增强仅对 `.vue`，更新已有 component 卡的 `related`/`signatures`，不新建卡。

### 3.5 Tier 1 基线修复（模块发现，与提取器正交）

在 `frontend.ts` / `pipeline.ts`：

- **P0-1 修复**：`discoverExports` 兜底改为以 `filePath.toLowerCase().endsWith(".vue")` 为 SFC 信号（不再在剥离后的 content 上检测 `<script`）；同时把**原始 SFC 文本**传给 `discoverExports` 或新增 `extractVueContract`（见 3.3）。
- **P0-2 修复**：`SOURCE_GLOBS` 扩展为 `["src/**/*.{ts,tsx,js,jsx,mjs,vue}"]`。
- **P1 修复**：`pipeline.ts` 增量模式下，把「本次发现但 `previousScan` 里没有的新包」自动加入 `affectedPackages`（backend modules 同理加一道）。
- **P2 修复**：`arch.config.json` 新增可选 `frontendPackages: string[]`（显式声明，优先于 workspace 探测）；workspace 探测为空且根无 `package.json` 时，自动扫描根的直接子目录里含 `package.json` 且有前端依赖（vue/react）的目录；探测为空时日志给明确提示，避免「静默成功」。

### 3.6 写入与检索

- `writer/` 新增三个资产文档 section（`api-clients.md` / `routes.md` / `stores.md`，与现有 `components.md`/`utils.md` 并列），按 `FrontendPackage.apiClients/routes/stores` 渲染。
- 新 `AssetKind`（`api-client`/`route`/`store`）进入 `ArchChunk.kind`，进向量库，`search_arch` 可语义检索；`query_arch` 可按 path 精读（如 `frontend/preaudit-web/api-client#userApi`）。
- 不新增/不改 MCP 工具签名（仍是 16 工具），仅返回内容更丰富。

## 4. 错误处理与容错

- 所有提取器**永不抛**：正则无命中返回空数组/`null`，调用方跳过。与现有 `extractFromSource`/`discoverExports` 的「容错扫描」理念一致。
- 长尾/边缘语法（非标准 axios 封装、手写 fetch、复杂嵌套路由）提取不全可接受 — 提取器只需捕获常见 idiom，LLM summarize 阶段对候选做语义补全，不要求 100% 覆盖。
- `scanPackageDir` 既有 `try/catch`（skip unreadable files）保留，语义 pass 复用同一保护。
- `.vue` 无 `<script setup>`（Options API / 无脚本）— `extractVueContract` 返回 `isComponent` 按实际，不误报。

## 5. 测试策略

每个新提取器纯函数，用 fixture 字符串单测（复用 `ts-doc.ts` 测试风格）：

| 提取器 | 关键用例 |
--------|----------|
| `extractApiClients` | axios 实例调用、模板路径 `${id}`、无调用文件返回空、导出名优先 |
| `extractRoutes` | vue-router createRouter + children 嵌套拍平、meta 提取、React `<Route`、无 routes 返回空 |
| `extractStores` | Pinia setup-store return keys、Vuex 四键集合、defineStore 无 return |
| `extractVueContract` | `<script setup>` + defineProps + emits、无脚本 SFC、Options API defineComponent、templateTags 抽取 |
| `discoverExports`（P0-1 修复） | `<script setup>` 无 defineProps → 仍登记 component、原始 SFC 入参 |

集成层：`scanPackageDir` 端到端用 `preaudit-web` fixture 断言 `apiClients/routes/stores` 非空、component 卡 `related` 非空。Tier 1 修复各配独立用例（`.js` 遍历、新包增量、非 JS 根自动发现）。

全量回归：`cd arch-engine && npx vitest run`（当前 181/181）须全绿。

## 6. 改动文件清单

| 文件/模块 | 变更 | Tier |
-----------|------|------|
| `arch-engine/src/types.ts` | `AssetKind` +3 成员；`FrontendPackage` +3 数组；3 新契约结构 | 2 |
| `arch-engine/src/scanners/frontend-api.ts` | 新增 | 2 |
| `arch-engine/src/scanners/frontend-router.ts` | 新增 | 2 |
| `arch-engine/src/scanners/frontend-store.ts` | 新增 | 2 |
| `arch-engine/src/scanners/frontend-vue-contract.ts` | 新增 | 2 |
| `arch-engine/src/scanners/frontend.ts` | `scanPackageDir` 加语义 pass；P0-2 glob 扩展；P2 frontendPackages + 自动发现 | 1+2 |
| `arch-engine/src/scanners/ts-export.ts` | P0-1 兜底修复（`.vue` 信号） | 1 |
| `arch-engine/src/pipeline.ts` | P1 新包增量；P2 配置消费 | 1 |
| `arch-engine/src/config.ts` | `DEFAULT_CONFIG` 加 `frontendPackages: []`；类型扩展 | 1 |
| `arch-engine/src/writer/`（asset-md.ts / markdown.ts 等） | 3 新 section 渲染；新 `AssetKind` 联合成员 | 2 |
| `arch-engine/tests/scanners/` | 4 新提取器单测 + `scanPackageDir` 集成 + Tier1 修复用例 | 1+2 |

**不改动**：后端 scanners（java*）、设计层（design/*）、MCP `index.ts` 工具签名、arch-incremental/git-diff 核心逻辑。

## 7. 风险与未决项

| 风险 | 缓解 |
|------|------|
| `AssetKind` 扩展触及多文件（types/writer/chunk/MCP 消费点） | 联合扩展是加法，TS 编译会标出所有遗漏消费点；逐一补 |
| 正则提取器对非标准 idiom 覆盖不全 | 仅捕获常见 idiom；LLM summarize 补全；长尾留后续版本 |
| 非 JS 根自动发现可能误纳入（如 monorepo 工具包） | 仅扫根直接子目录 + 必须有前端依赖（vue/react）+ 可被 `frontendPackages` 显式覆盖 |
| 模板路径（`/user/${id}`）与后端 path 对齐 | 原样保留为 string；对齐留作 query_arch 文本检索，不做硬链接 |
| Vue SFC `<template>` 标签抽取可能含 HTML 原生标签（div/span） | 过滤已知 HTML 标签白名单，仅留 PascalCase / 库前缀（el-/a-/van-）组件 |

## 8. 成功标准

- `preaudit-web` 全量扫描后：`components.md` ≥ 11 个 Vue 组件（修 P0-1），`api-clients.md` ≥ 5 个 API 客户端（修 P0-2 + 提取器），`routes.md` 1 个路由卡（含全部路由项），`stores.md` 1 个 store 卡。
- `query_arch path=frontend/preaudit-web/api-client#userApi` 返回含 HTTP 方法+路径的契约。
- `search_arch("用户登录前端调用")` 命中 `userApi.login`。
- 首次纳入新前端包的普通 `start-init`（非 `--full`）能正确登记（修 P1）。
- 前端工程嵌套在 Java 根下无需手改 workspace 即可被发现（修 P2）。
- `cd arch-engine && npx vitest run` 全绿，无回归。

## 9. 版本与交付

- 版本号：2.0.1（前端能力增强，后端不动）。
- 实现：经 `/plan-from-spec` 生成 plan，`/implement-plan` 子 Agent 串行实现，`/verify` 验收。
- 实现后对 `ApiClientContract` / `RouteEntry` / `StoreContract` 三个新对外 TS 类型 `register_contract`。
