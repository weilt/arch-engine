# Java API 路径规则补齐设计（声明式前缀 + 扩展发现 + 重算）

**日期:** 2026-07-04  
**状态:** 已批准（2026-07-04 用户确认 §14 三项建议）  
**关系:** 扩展 `2026-06-01-arch-bootstrap-design.md`；补强现有 `java-path-rules.ts`（v2.0.x 已落地 WebMvcRegistrations 链）  
**痛点:** 独立 starter / `WebMvcConfigurer` / 仅 JAR 依赖中的前缀配置在 `start-init` 时漏扫；扫描后无法在编辑器内声明规则并写回资产与关系图  

---

## 1. 背景与问题

### 1.1 现状（2026-07-04）

`start-init` 在扫 Controller 之前调用 `resolveJavaPathRules()`，将 `context-path` + 包名匹配前缀拼到注解路径上，再写入 `api.md`、`arch-index.json`、API 向量 chunk。

| 能力 | 状态 |
|------|------|
| `WebMvcRegistrations` → `WebProperties` → `new Api(prefix, pattern)` | ✅ |
| `application*.yml` 覆盖 `base.web.*.prefix` | ✅（须先找到 Properties 类） |
| `addPathPrefix` / `pathPrefixes.put` 内联 | ✅（须在含 `WebMvcRegistrations` 的文件内） |
| `server.servlet.context-path` | ✅ |
| **`WebMvcConfigurer` + `configurePathMatch`** | ❌ |
| **独立扫描 `WebProperties.java`（无 Registrations 触发）** | ❌ |
| **沿 `AutoConfiguration.imports` 定位 starter 配置类** | ❌（starter 扫描仅写 `starter.md`） |
| **`arch.config` 手动 `controllerPathPrefixes`** | ❌ |
| **对话/MCP 声明规则并触发 API 重算** | ❌ |
| **`start-init --reindex-apis`（不重跑全模块 summarize）** | ❌ |
| **Maven 依赖 JAR 内无源码的配置** | ❌（硬限制，仅文档化 + 手动规则兜底） |
| **前端 `baseURL` / 封装层全局前缀** | ❌（另 spec，本 spec 仅列接口预留） |

### 1.2 典型漏扫场景

1. **独立组件仓：** `WebProperties` 在 `xxx-spring-boot-starter`，业务仓只引 Maven 依赖 → 工作区无 `.java` → `confidence: low`。
2. **同 monorepo 不同写法：** 使用 `implements WebMvcConfigurer`，类中无 `WebMvcRegistrations` 字符串 → 规则链不触发。
3. **Properties 与 Config 分离：** starter 仅有 `WebProperties.java`，注册逻辑在 `@AutoConfiguration` 匿名类 → 无 Registrations 入口文件。
4. **扫描根过窄：** 对 `xxx-server` 子目录跑 `start-init`，框架模块在兄弟路径 → 规则文件不在 `cwd`。
5. **扫描后纠错：** 用户在编辑器口述「admin 包前缀 `/admin-api`」→ 无 MCP/CLI 写回 `.ai/arch`。

### 1.3 目标

1. **P0：** `arch.config.json` 支持声明式 `controllerPathPrefixes`；合并进 `resolveJavaPathRules`；提供 **`start-init --reindex-apis`** 仅重算 API 文档/索引/向量（及 `flow.json` 若需）。
2. **P1：** 扩展自动发现：`WebProperties` 直连、`WebMvcConfigurer`、`AutoConfiguration.imports` 链、`extraSourceRoots`。
3. **P2：** MCP **`update_java_path_rules`**：AI 将自然语言规则落库并触发重算；可选 **`report_path_rule_gap`** 只读诊断。
4. **可观测：** `--verbose` 与 `last-scan.json` 记录规则来源（`auto` / `manual` / `yml`）与 `confidence`。

### 1.4 非目标

- 反编译或解析 `.m2` / `lib/*.jar` 内 class（超出静态扫描范围；用手动规则 + OpenAPI 兜底）。
- 本 spec 不实现前端 `baseURL` 解析（预留 `arch.config.java` 旁 `frontend.apiBaseUrl` 字段，实现另开 spec）。
- 不在 `flow.json` 中新增 HTTP path 级 `api-client → controller` 边（P3 增强；本 spec 仅保证 API path 修正后 flow 阶段可重跑）。
- 不改变 OpenAPI 与 Java 合并优先级（OpenAPI 仍优先）。

---

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 手动规则存储 | **`arch.config.json`** 内 `java.controllerPathPrefixes`（入 git；不含 secret） |
| 合并策略 | **手动与自动合并**；同 `controllerPattern` 冲突时 **manual 始终覆盖 auto**（不因 auto `confidence: high` 而保留自动规则） |
| 重算入口 | **`start-init --reindex-apis`**（可组合 `--verbose`）；全量结构变更仍用 `--full` |
| MCP 写侧 | 新增 **`update_java_path_rules`**（upsert 规则 + 调 reindex-apis）；finish/verify 流程不自动调用 |
| MCP 读侧 | **`query_path_rules` 放在波次 3**；波次 1 用 `query_arch` 验证 path |
| 多根扫描 | **`java.extraSourceRoots`**：相对 `projectRoot` 的路径数组，仅用于 path-rules 发现（不自动加入 Maven 模块列表） |
| 规则持久化审计 | 写入 **`.ai/arch/path-rules.json`**（**入 git**，与 `arch-index.json` 一致；无 secret） |
| 向量 | reindex-apis **重 embed 所有 API chunk**（数量可控）；不重跑 utils/pojo summarize |

---

## 3. 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│  来源层                                                              │
│  ① 自动：WebMvcRegistrations / WebMvcConfigurer / WebProperties   │
│         AutoConfiguration.imports / application*.yml                │
│  ② 手动：arch.config.java.controllerPathPrefixes                    │
│  ③ 扩展根：arch.config.java.extraSourceRoots                        │
└───────────────────────────────┬─────────────────────────────────────┘
                                ▼
                    resolveJavaPathRules()  →  ResolvedJavaPathRules
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
      path-rules.json    scanJavaSources     (verbose 日志)
              │                 │
              ▼                 ▼
      start-init --reindex-apis（或 --full 内含）
              │
              ├─ api.md（各 backend 模块）
              ├─ arch-index.json（API anchors / keywords）
              ├─ vectors.db（API kind chunks upsert + 删除旧 API id）
              └─ flow.json（重跑 flow phase，若 entityNames 非空）
```

**与 `refresh_asset` 边界：** `refresh_asset` 仍只处理单文件 AssetCard（util/pojo/…）；**批量 API path 变更一律走 reindex-apis**，避免误用。

---

## 4. 配置模型

### 4.1 `arch.config.json` 扩展

```json
{
  "java": {
    "extraSourceRoots": ["../company-framework"],
    "controllerPathPrefixes": [
      {
        "prefix": "/admin-api",
        "controllerPattern": "**.controller.admin.**",
        "source": "manual",
        "note": "用户声明：管理端 Controller 统一前缀"
      },
      {
        "prefix": "/app-api",
        "controllerPattern": "**.controller.app.**",
        "source": "manual"
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `java.extraSourceRoots` | `string[]?` | 相对 `projectRoot`；glob 限制为 `**/*.java`、`**/application*.yml` |
| `java.controllerPathPrefixes` | `ControllerPathPrefixRule[]?` | 与扫描器内部类型对齐；`source` 固定为 `manual` 或省略 |
| `controllerPattern` | string | Spring Ant 风格，`.` 为包分隔符，如 `**.controller.admin.**` |
| `prefix` | string | 以 `/` 开头，不含 trailing `/` |

`ArchConfig` 类型扩展：在 `types.ts` 增加可选 `java?: JavaScanConfig`。

### 4.2 解析结果快照 `.ai/arch/path-rules.json`

```json
{
  "resolvedAt": "2026-07-04T12:00:00.000Z",
  "contextPath": "",
  "confidence": "high",
  "rules": [
    {
      "prefix": "/admin-api",
      "controllerPattern": "**.controller.admin.**",
      "source": "manual",
      "overrides": null
    },
    {
      "prefix": "/app-api",
      "controllerPattern": "**.controller.app.**",
      "source": "WebProperties:field:appApi",
      "file": "framework/.../WebProperties.java"
    }
  ],
  "sources": ["..."],
  "warnings": []
}
```

每次 `resolveJavaPathRules` 或 `update_java_path_rules` 后更新；**纳入 `.ai/arch/` 标准产物并提交 git**；`start-init --full` 清理 arch 输出时随全量重建。

---

## 5. 规则合并语义

### 5.1 解析流水线（新）

```ts
async function resolveJavaPathRules(projectRoot, config): Promise<ResolvedJavaPathRules> {
  const roots = [projectRoot, ...config.java?.extraSourceRoots?.map(r => resolve(projectRoot, r)) ?? []];
  const auto = await discoverAutoPathRules(roots);      // §6
  const manual = config.java?.controllerPathPrefixes ?? [];
  return mergePathRules(auto, manual);
}
```

### 5.2 `mergePathRules`

1. 以 `controllerPattern` 规范化（trim）为 key 去重。
2. 先入 **auto** 规则。
3. 再入 **manual**：同 key → **manual 始终覆盖 auto**；若覆盖了 auto 规则，在 `path-rules.json` 对应条目的 `overrides` 字段记录被覆盖的 auto `source`（供审计，非告警）。
4. `confidence`：
   - 任一 manual 且 auto 为空 → `medium`
   - manual + auto 非空 → `high`（若 auto 原为 high）或 `medium`
   - 仅 auto 且原逻辑 → 保持现有 high/medium/low

### 5.3 应用点（不变）

`applyPathRulesToEndpointPath(rules, packageName, annotationPath)` — 所有 Controller 扫描、reindex-apis 必须共用同一 `ResolvedJavaPathRules` 实例。

---

## 6. 扩展自动发现（P1）

在现有 `java-path-rules.ts` 上增加 **`discoverAutoPathRules(roots)`**，按优先级合并（后者不覆盖前者已命中的 pattern）：

| 优先级 | 探测器 | 触发条件 | 产出 |
|--------|--------|----------|------|
| A | `WebMvcRegistrations` 链 | 现有逻辑 | 保持 |
| B | **`WebProperties` 直连** | 任意 `.java` 含 `new Api("` + `@ConfigurationProperties` | 不依赖 Registrations |
| C | **`WebMvcConfigurer`** | `implements WebMvcConfigurer` 且含 `addPathPrefix` / `pathPrefixes` / `configurePathMatch` | 解析内联前缀；包 pattern 用 admin/app/pc 启发式或第二个字符串参数 |
| D | **AutoConfiguration 链** | 复用 `java-starter.ts` 读 `AutoConfiguration.imports` / `spring.factories` → 加载配置类源码 → 跑 B/C | 覆盖「规则只在 starter 自动配置类」 |
| E | **yml-only 补充** | `base.web.*.prefix` + `*.controller` 在 yml 存在但 Java 无默认 | `confidence: medium` |

**`WebMvcConfigurer` 解析（最小可行）：**

```java
// 识别
registry.addPathPrefix("/admin-api", c -> c.getPackageName().contains(".controller.admin."));
// 或
pathPrefixes.put("/admin-api", "**.controller.admin.**");
```

正则参考现有 `INLINE_PREFIX_RE`，扩展捕获 `Predicate` / lambda 中的 `controller.admin` 片段还原 pattern。

**限制（文档明示）：** 复杂动态 prefix（运行时计算）不解析 → 落 `warnings`，建议 manual 或 OpenAPI。

---

## 7. CLI：`start-init --reindex-apis`

### 7.1 行为

在已有 `.ai/arch/`（至少一次成功 `start-init`）前提下：

1. `loadOrInitConfig` + `resolveJavaPathRules`（含 manual / extra roots）
2. `findMavenModules` + `scanJavaSources` + `scanOpenApiGlobs` → 合并 API 列表（与全量 scan 相同合并规则）
3. **仅更新 API 相关产物：**
   - 各模块 `backend/<slug>/api.md`
   - `arch-index.json` 中 API 节点的 `anchors`、`keywords`
   - `vectors.db`：删除 `kind=api` 且 path 前缀为受影响模块的旧 chunk；upsert 新 API chunks（`chunkStructuredEntities` 的 api 部分）
4. 若 `entities.json` 存在且 `entityNames` 非空 → 重跑 flow phase → `flow.json` / `flow.md`
5. 写 `path-rules.json`；更新 `last-scan.json` 增加字段 `pathRulesHash`（规则内容 hash，供增量判断）

**不执行：** 模块级 Java/前端 candidate summarize、`utils.md` / `pojo.md` 批量重写、`store.clear()`。

### 7.2 参数

```bash
start-init --reindex-apis [--verbose] [projectRoot]
```

| 场景 | 命令 |
|------|------|
| 用户口述规则后 | MCP `update_java_path_rules` → 内部调 reindex-apis |
| 改了 `arch.config` 手动规则 | `start-init --reindex-apis --verbose` |
| 改了框架源码 + 自动发现 | 同上；若还改了非 API 资产 → `sync-changes` |
| 首次无 `.ai/arch` | 必须先 `start-init` 或 `--full` |

### 7.3 失败与降级

- 无 Git / 无 `last-scan.json`：允许 reindex-apis（不依赖 incremental）
- Embedding Key 缺失：**exit 1**（与全量 start-init 一致，API 向量不半成品）
- OpenAPI glob 为空且 Java 模块为空：exit 0，写空 rules 快照 + warn

---

## 8. MCP 工具

### 8.1 `update_java_path_rules`（P2，写侧）

**用途：** 编辑器内用户/AI 声明「某包下的 Controller 前缀」，持久化并触发重算。

**参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `rules` | `{ prefix, controllerPattern, note? }[]` | 是 | upsert 到 `arch.config.java.controllerPathPrefixes` |
| `mode` | `"merge"` \| `"replace-manual"` | 否 | 默认 `merge`；`replace-manual` 清空后写入 |
| `reindex` | `boolean` | 否 | 默认 `true`；调 `reindex-apis` |
| `extraSourceRoots` | `string[]` | 否 | 可选同时更新 `java.extraSourceRoots` |

**返回：**

```json
{
  "ok": true,
  "pathRulesFile": ".ai/arch/path-rules.json",
  "rulesApplied": 2,
  "reindex": {
    "apis": 1446,
    "modulesUpdated": ["base-module-system-server"],
    "samplePaths": [
      { "before": "POST /system/auth/login", "after": "POST /admin-api/system/auth/login" }
    ]
  }
}
```

**权限：** 与 `register_asset` 同级；**`/verify` 禁止调用**（同 refresh_asset 规则）。

### 8.2 `query_path_rules`（波次 3，只读）

返回 `path-rules.json` + 当前 `arch.config` 手动段 + 最近一次 reindex 的 `pathRulesHash`。供 AI 在声明前核对，避免重复写入。波次 1–2 用 `query_arch` 抽 API path 代替。

### 8.3 Agent 工作流补充（`AGENTS.md` / finish-feature）

当用户纠正 API 前缀时：

1. `query_path_rules`（若已实现）或 `query_arch` 抽一条 API 看 path 是否缺前缀  
2. `update_java_path_rules` 写入规则并 `reindex: true`  
3. `query_arch` 验证样本 path  
4. **不**对单个 Controller 循环 `refresh_asset`

---

## 9. 与 OpenAPI / 增量扫描的关系

| 机制 | 行为 |
|------|------|
| OpenAPI vs Java | **不变**：OpenAPI path 优先；Java 多出的端点带解析后前缀 |
| `start-init` 增量 | 默认**仍不重写** `api.md`；若 `pathRulesHash` 相对 `last-scan` 变化 → **日志 warn**：建议 `--reindex-apis` |
| `sync-changes` | **不变**；不触发 API path 重算 |
| `audit_arch_changes` | 可选增强：API path 与 `path-rules.json` 不一致时增加 `apiPathStale: true` 提示（P3） |

---

## 10. 分波次交付

### 波次 1 — P0 手动规则 + reindex-apis（可独立验收）

- [ ] `ArchConfig.java` 类型与默认配置模板  
- [ ] `mergePathRules` + manual 段  
- [ ] `path-rules.json` 写入  
- [ ] `start-init --reindex-apis`  
- [ ] `pathRulesHash` in `last-scan.json`  
- [ ] 单测：manual 覆盖、reindex 后 `api.md` / vectors 更新  
- [ ] README FAQ 更新  

### 波次 2 — P1 扩展自动发现

- [ ] `WebProperties` 直连扫描  
- [ ] `WebMvcConfigurer` 最小解析  
- [ ] `AutoConfiguration.imports` 链  
- [ ] `extraSourceRoots`  
- [ ] yml-only 补充规则  
- [ ] fixture：`framework-starter` 无 Registrations 的测试仓  

### 波次 3 — P2 MCP + 诊断

- [ ] `update_java_path_rules`  
- [ ] `query_path_rules`  
- [ ] mcp-server 测试 + AGENTS.md 工作流  
- [ ] `inject-platform-assets` 分发  

### 波次 4 — P3（可选）

- [ ] `audit_arch_changes.apiPathStale`  
- [ ] 前端 `apiBaseUrl`（另 spec 挂钩）  
- [ ] `flow.json` HTTP path linker（api-client endpoint → backend api node）  

---

## 11. 验收标准

### 11.1 狗食场景 A — 口述规则

1. 业务仓 `start-init --full` 后，某 admin Controller API 在 arch 中为 `GET /system/user/list`（缺前缀）。  
2. AI 调用 `update_java_path_rules({ rules: [{ prefix: "/admin-api", controllerPattern: "**.controller.admin.**" }] })`。  
3. `query_arch("backend/.../api#GET-...")` 返回 `GET /admin-api/system/user/list`。  
4. `search_arch("admin 用户列表")` top-3 命中带 `/admin-api` 的 path。  

### 11.2 狗食场景 B — 独立 starter 源码（波次 2）

1. monorepo 含 `framework-spring-boot-starter`，仅 `WebProperties` + `@AutoConfiguration`，无 `WebMvcRegistrations` 字符串。  
2. `start-init --full --verbose` → `path-rules.json` 含 `/admin-api`；`confidence` ≥ `medium`。  

### 11.3 狗食场景 C — 仅 JAR 依赖

1. 业务仓无框架源码。  
2. 用户配置 manual 规则 + `reindex-apis` → API path 正确；`path-rules.json.sources` 含 `manual`。  

### 11.4 非回归

- 现有 `java-path-rules.test.ts` / 芋道 fixture 全绿。  
- `reindex-apis` 不修改无关 `utils.md` 的 mtime（或 hash 不变）。  
- `/verify` 不调用 `update_java_path_rules`。  

---

## 12. 测试计划

| 层级 | 内容 |
|------|------|
| 单元 | `mergePathRules`、manual 覆盖、`WebMvcConfigurer` 解析、`extraSourceRoots` glob |
| 集成 | `reindex-apis` 更新 api.md + vectors；`pathRulesHash` 变化触发 warn |
| MCP | `update_java_path_rules` mock projectRoot；config 原子写 |
| Fixture | `tests/fixtures/java-path-rules/`：starter-only、configurer-only、manual-fallback |

---

## 13. 文档与迁移

- **README** §「Java Controller URL 前缀」：补充 manual 配置、`--reindex-apis`、独立 starter 限制、JAR 兜底。  
- **现有项目迁移：** 无 breaking change；旧 `arch.config` 无 `java` 段时行为与现网一致。  
- **FAQ 新增：**  
  - 「规则在依赖 JAR 里怎么办？」→ manual + OpenAPI。  
  - 「改了 arch.config 要跑什么？」→ `--reindex-apis`，不是增量 `start-init`。  

---

## 14. 批准记录（2026-07-04）

| 问题 | 决定 |
|------|------|
| manual 与 auto 冲突 | **manual 始终覆盖**（用户确认） |
| `path-rules.json` 是否入 git | **入 git**（用户确认） |
| `query_path_rules` 排期 | **波次 3**；波次 1 用 `query_arch`（用户确认） |

---

## 15. 参考实现位置

| 模块 | 路径 |
|------|------|
| 现有规则解析 | `arch-engine/src/scanners/java-path-rules.ts` |
| Controller 扫描 | `arch-engine/src/scanners/java.ts` |
| pipeline 入口 | `arch-engine/src/pipeline.ts` |
| Starter 自动配置 | `arch-engine/src/scanners/java-starter.ts` |
| API chunk | `arch-engine/src/chunking/semantic.ts` → `chunkStructuredEntities` |
| Flow 图 | `arch-engine/src/scanners/flow-scanner.ts` |
| 配置类型 | `arch-engine/src/types.ts` → `ArchConfig` |
