# arch-engine 前端扫描能力诊断报告

> 来源项目:`D:\software\preaudit`(Vue 3 + Vite + Element Plus 后台)
> 工具:`C:\Users\weilt\.apt\arch-engine`
> 诊断日期:2026-06-27
> 结论:**当前前端扫描器无法登记真实 Vue 3 项目的有效契约,需增强**

## TL;DR

在一个 Java/Maven 后端项目里嵌套一个独立 Vue 3 SPA(`preaudit-web`,23 个源文件)的实测中,arch-engine 的前端扫描暴露 4 个问题,其中 2 个是阻塞项:

1. **[P0 阻塞] `<script setup>` 组件全部识别失败** — 兜底判定逻辑在 `extractVueScript` 的输出(已剥离 `<script>` 标签)上检测 `<script`,条件永远为假。实测 11 个 `.vue` 组件 0 命中。
2. **[P0 阻塞] `.js` 文件被 glob 硬性排除** — `SOURCE_GLOBS` 只含 `{ts,tsx,vue}`,导致 API 客户端、路由、状态管理(`api/*.js`、`router/index.js`、`stores/*.js`)这些**核心前端契约全部丢失**。
3. **[P1] 增量扫描对新发现的前端模块有盲区** — 新增的前端包文件不在 git diff 里,增量模式会跳过它,必须 `--full` 才能首次登记。
4. **[P2] 模块发现对"非 JS 根项目"不友好** — 只认 `pnpm-workspace.yaml` 或根 `package.json` 的 `workspaces`,前端工程嵌套在 Java/Maven 等非 JS 根下时无法被发现。

**这正是"前端扫描功能不够登记真正前端契约"的实证**:即便模块被发现并写入索引,`components.md` / `utils.md` 仍是空的,真正的前端资产(API 调用、路由、组件、状态)一个都没进索引。

---

## 复现环境

```
项目结构:
  preaudit/                      # Java/Maven 根(无 package.json)
  |- preaudit-admin/             # 后端 Maven 多模块
  +- preaudit-web/               # Vue 3 + Vite + Element Plus
     +- src/
        |- api/        (*.js)    mapping.js request.js skill.js stats.js user.js
        |- components/ (*.vue)   Layout.vue
        |- router/     (*.js)    index.js
        |- stores/     (*.js)    user.js
        |- views/      (*.vue)   dashboard/login/mapping/settings/skill/stats
        |- App.vue
        +- main.js

源文件统计:11 个 .vue + 8 个 .js + 4 个 .ts(spec)
组件特征:全部 <script setup>,无 defineProps(用 ref/computed)
```

扫描配置 `.ai/arch/arch.config.json` 已正确开启:

```json
{ "scanners": { "java": true, "frontend": true } }
```

实测全量扫描结果:`packages: 1`(模块被发现),但 `assetCardCount` 里前端贡献为 0,`components.md` / `utils.md` 均为 "_No components/utils discovered._"

---

## P0-1:`<script setup>` 组件识别失败

### 现象

11 个 `.vue` 组件全部未被识别为 component candidate,`components.md` 为空。

### 根因

`dist/scanners/ts-export.js` 的 `discoverExports` 末尾有两个针对组件的兜底:

```js
// 兜底 1:Vue Options API(defineComponent)
if (isComponentFile(filePath) && /defineComponent\s*\(/.test(content)) {
    pushUnique(results, { name: pathBaseName(filePath), kindHint: "component" });
}
// 兜底 2:通用 SFC 兜底
if (
    isComponentFile(filePath) &&
    results.length === 0 &&
    (/<script[\s>]/i.test(content) || content.includes("defineProps"))
) {
    pushUnique(results, { name: pathBaseName(filePath), kindHint: "component" });
}
```

这里的 `content` 是 `discoverExports` 的入参 `fileContent`。而调用方 `scanPackageDir` 传入的是:

```js
// frontend.js - scanPackageDir
const content = await readSourceContent(path.join(pkgDir, relativeFile));
// .vue 时 readSourceContent 返回 extractVueScript(raw)
const discovered = discoverExports(content, relativeFile);
```

`dist/scanners/ts-doc.js` 的 `extractVueScript` 已剥离了 `<script>` 标签:

```js
export function extractVueScript(content) {
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    return scriptMatch?.[1] ?? "";   // 只返回标签「内部」内容,不含 <script> 标签本身
}
```

所以兜底 2 的 `/<script[\s>]/i.test(content)` 在 `.vue` 文件上**永远为 false**(标签早已被剥离)。只剩 `content.includes("defineProps")` 一条,而本项目所有组件用 `ref/computed`、**没有任何 `defineProps`**,于是全部落空。

### 影响

这是最致命的一条:`<script setup>` 是 Vue 3 的官方推荐写法,SFC 内部不写任何 `export` 语句。一旦组件不用 `defineProps`(常见,例如纯展示组件、纯 `ref` 组件),就无法被识别为组件,**整个组件树都进不了索引**。

### 建议修复

核心思想:组件判定应基于文件特征,不应依赖"标签是否还在 content 里"。

```js
// 方案 A(推荐):isComponentFile 已确认是 .vue/.tsx,且无显式 export -> 直接按组件登记
// 用文件级标志位(endsWith .vue)而不是在剥离后的 content 里找 <script
if (
    isComponentFile(filePath) &&
    results.length === 0 &&
    filePath.toLowerCase().endsWith(".vue")   // <- SFC 本身即组件信号,不再检测 content
) {
    pushUnique(results, { name: pathBaseName(filePath), kindHint: "component" });
}
```

配套增强(让 `<script setup>` 的 props/emits 也能被抽成契约签名):

```js
// 方案 B:从 <script setup> 抽取 defineProps / defineEmits / defineModel 作为签名
//   defineProps<{...}>() / defineProps({...}) / withDefaults(...)
//   defineEmits<...>()
// 把 props 字段、emit 事件名收集进 signatures,作为组件契约
```

建议同时把 `extractVueScript` 的**原始 SFC 文本**一并传给 `discoverExports`(或新增 `extractVueContract`),这样既能拿到标签特征,也能解析 `<script setup>` 的宏。

---

## P0-2:`.js` 文件被 glob 硬性排除

### 现象

`api/*.js`、`router/index.js`、`stores/user.js`、`main.js` 共 8 个 `.js` 文件**全部不在扫描范围内**,这些恰恰是前端最关键的对外契约(API 客户端、路由表、全局状态)。

### 根因

`dist/scanners/frontend.js` 顶部的 glob 常量:

```js
const SOURCE_GLOBS = ["src/**/*.{ts,tsx,vue}"];   // 不含 .js / .jsx / .mjs
```

`collectSourceFiles` 直接用它,`.js` 永远不会被遍历。

### 影响

Vue CLI、Vite 脚手架默认大量使用 `.js`(API 层、路由、store、工具函数)。不纳入 `.js` 等于丢掉前端的"服务调用面"和"路由结构",而这些正是前后端联调最需要的契约。

### 建议修复

```js
const SOURCE_GLOBS = [
    "src/**/*.{ts,tsx,js,jsx,mjs,vue}",   // 纳入 .js / .jsx / .mjs
];
```

`discoverExports` 的 `export function/const/class/enum/default` 正则对 `.js` 同样有效,无需额外改动即可提取具名导出。对 `.vue` 的兜底逻辑同步按 P0-1 修复即可。

---

## P1:增量扫描对新发现的前端模块有盲区

### 现象

新增 `pnpm-workspace.yaml` 让 `preaudit-web` 首次进入扫描范围后,**普通 `start-init`(增量)不索引它**,日志显示:

```
scan complete { modules: 4, apis: 52, rpcs: 0, packages: 1, incremental: true }
incremental mode { changedFiles: 0, affectedModules: [], affectedPackages: [] }
done { chunkCount: 0 }
```

模块已被发现(`packages: 1`),但 `affectedPackages` 为空,实际处理被跳过。只有加 `--full` 才能首次登记成功。

### 根因

`dist/pipeline.js`:

```js
let incremental = !options.full && previousScan !== null;
// ...
if (incremental && previousScan) {
+    affectedModules = mapFilesToModules(changed, model.modules);
+    affectedPackages = mapFilesToPackages(changed, model.packages, packageDirs, projectRoot);
+}
const packagesToProcess = incremental
    ? model.packages.filter((p) => affectedPackages.has(p.slug))   // <- 新包不在 affected 里
    : model.packages;
```

`mapFilesToPackages` 依据 **git diff 的变更文件**。新前端包的源文件本身没改(改的是新增的 workspace 配置文件),不在 diff 里,于是新包被过滤掉。

### 影响

用户首次把一个前端工程纳入索引时,跑常规 `start-init` 会"看起来成功但内容为空",非常隐蔽,容易误判为扫描器坏了。

### 建议修复

增量模式下,把"本次发现但 `previousScan` 里没有的新包"自动加入 `affectedPackages`:

```js
if (incremental && previousScan) {
    affectedPackages = mapFilesToPackages(changed, ...);
    // 新增:首次出现的包强制全量处理
    for (const p of model.packages) {
        if (!previousScan.packages?.[p.slug]) affectedPackages.add(p.slug);
    }
    // 同理对 backend modules 也可加一道
}
```

---

## P2:模块发现对"非 JS 根项目"不友好

### 现象

`preaudit-web` 嵌套在 Java/Maven 根下,根目录既无 `package.json` 也无 `pnpm-workspace.yaml`,前端工程长期无法被发现,直到手动创建 `pnpm-workspace.yaml`。

### 根因

`dist/pipeline.js` 的 `resolveFrontendPackageDirs` 与 `frontend.js` 的 `getWorkspacePatterns` 只认两种来源:

1. 根 `pnpm-workspace.yaml` 的 `packages`
2. 根 `package.json` 的 `workspaces`(或 `workspaces.packages`)

都没有时,`scanFrontend` 回退到"扫描项目根自身",而 Java 根没有 `package.json`,于是返回空。

### 影响

前后端混合仓库(很常见:Java/Go/Python 根 + 前端子目录)里,前端工程默认不可见,必须手工补 workspace 文件。用户不一定知道这个约定。

### 建议修复(任选其一,组合更佳)

- **配置项兜底**:在 `arch.config.json` 增加显式 `frontendPackages: ["preaudit-web"]`,扫描器优先读它,绕过 workspace 探测。
- **自动发现**:当 workspace 探测为空时,扫描"根的直接子目录里含 `package.json` 且有前端依赖(vue/react)的目录",自动纳入。`inferFramework` 已具备框架识别能力,可直接复用。
- **诊断提示**:探测为空且根无 `package.json` 时,在日志里给出明确提示("未发现前端工程,可配置 frontendPackages 或添加 pnpm-workspace.yaml"),避免"静默成功"。

---

## 验证 / 复现步骤

1. 在 `preaudit` 根添加 `pnpm-workspace.yaml`(`packages: [preaudit-web]`)。
2. 跑 `start-init --full`,确认日志出现 `scan complete { packages: 1 }` 与 `frontend/preaudit-web/overview` chunk。
3. 检查 `.ai/arch/frontend/preaudit-web/components.md` —— **当前为空(复现 P0-1)**。
4. 临时把某组件改成 `Options API + defineComponent` 或加 `defineProps`,重新扫描,该组件才会出现(佐证兜底逻辑的触发条件)。
5. 临时把某 `.js`(如 `api/request.js`)重命名为 `.ts`,扫描后它才会被遍历(佐证 P0-2)。

## 修复后预期

| 资产类型 | 当前 | 修复 P0-1/P0-2 后预期 |
|---|---|---|
| Vue 组件(`<script setup>`) | 0 | 11 个 component |
| API 客户端(`api/*.js`) | 0 | 6 个 util(API 调用契约) |
| 路由(`router/index.js`) | 0 | 1 个 util(路由表) |
| 状态(`stores/user.js`) | 0 | 1 个 util(store) |
| 入口(`main.js`) | 0 | 1 个 util |

修复后,前端工程的"调用面 + 路由 + 组件 + 状态"才能被 `query_arch` / `search_arch` 检索到,真正满足"登记前端契约"的需求。

## 附录:本次实测的前端工程清单

```
preaudit-web/src/
  api/mapping.js        api/request.js      api/skill.js
  api/stats.js          api/user.js
  components/Layout.vue
  router/index.js
  stores/user.js
  views/dashboard/Dashboard.vue
  views/login/Login.vue
  views/mapping/MappingEdit.vue  views/mapping/MappingList.vue
  views/settings/SystemSettings.vue
  views/skill/SkillEditor.vue    views/skill/SkillList.vue
  views/stats/StatsOverview.vue  views/stats/StatsReport.vue
  App.vue  main.js
```

- 11 个 `.vue`:全部 `<script setup>`,**均无 `defineProps`**
- 8 个 `.js`:API/路由/store/入口,全部被 glob 排除
- 4 个 `.ts`:均为 `*.spec.ts` 测试文件

(注:`Get-Content` 在 PowerShell 终端显示中文为乱码,属终端 GBK 编码问题;`node` 以 UTF-8 读取 SFC 正常,`extractVueScript` 正则能命中 `<script setup>`,与编码无关。)