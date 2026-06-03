# Arch AI 驱动扫描 v2 设计规格

**日期:** 2026-06-02  
**状态:** 已批准  
**关系:** 扩展 Arch Bootstrap（`start-init`）与 APT MCP；替代 v1「固定目录 + 纯正则」扫描的半成品体验  
**验证项目:** `E:\chongqing`（`base-common` 等 backend 公共模块）

---

## 1. 背景与问题

### 1.1 v1 已验证的缺口

| 问题 | 证据（chongqing `base-common`） |
|------|--------------------------------|
| Backend 公共模块几乎无资产 | `.ai/arch/backend/base-common/` 仅 `overview.md` + 空 `api.md` + 误报空 `rpc.md` |
| Utils / Enum / DTO 未索引 | 源码约 24 个 `*Utils`、11 个 enum、7 个 Feign CommonApi、10+ DTO，均未写入 arch |
| Feign 解析 bug | 项目使用 `@FeignClient(name = ...)`，扫描器只认 `value = "字面量"` |
| 开发时无法补充架构向量 | `register_contract` 只更新 `.ai/db.json` + `.ai/INDEX.md`，**不**更新 `vectors.db` |
| 前端发现绑死目录 | 仅 `src/components/**`、`src/utils/**` 等固定 glob，不适配 monorepo package 结构 |
| Agent 搜不到「该用什么」 | `search_arch("JSON 工具类")` 对 `JsonUtils` 无结果 |

### 1.2 v2 目标（成功标准）

1. **首次 `start-init`**：全量 AI 扫描，按模块分批；每模块完成后写入 markdown + 向量，再扫下一模块（内存可控）。
2. **后续 `start-init`**：基于 git diff 增量，只重扫变更文件所属模块/包；**upsert** 向量而非全库重建。
3. **开发闭环**：`/finish-feature` 新增资产时调用 **`register_asset`**，立刻 embed 进 `vectors.db`。
4. **双轨保留**：`register_contract` 继续服务 TS 契约；`register_asset` 服务架构资产（component/util/enum/starter/api 等）。
5. **可验证**：对 chongqing 执行全量 `start-init` 后，`search_arch("通用状态枚举")` top-3 命中 `CommonStatusEnum`；`search_arch("字典 RPC")` 命中 `DictDataCommonApi`。
6. **无 Embedding 配置时 exit 1**（与 v1 一致，不产出无向量半成品）。

---

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 范围 | **发现 + AI 深度总结**（不绑固定目录；输出 Agent 可直接用的 AssetCard） |
| 首次扫描 | **全量**；按模块/包分批，批间可 clear 中间态 |
| 增量机制 | **Git diff**（相对 `last-scan.json` 记录的 commit） |
| 技术栈 v2 | Java/Spring + OpenAPI/Apifox + TS/Vue/React **做透**；Go/Python 后续 |
| Starter | **A+B**：Maven `*-starter` + 前端 design-system 基础 UI 包 |
| 架构注册 | **方案 1 双轨**：保留 `register_contract`；新增 `register_asset` |
| 质量原则 | **不做 v1 快修半成品**；一次性交付可闭环 v2 |

---

## 3. 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│  /finish-feature                                                  │
│  TS 契约 → register_contract                                      │
│  新组件/utils/enum/starter → register_asset → embed → vectors.db │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│  start-init CLI                                                   │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────────┐  │
│  │ Discovery   │ → │ AI Summarize │ → │ Writers + VectorStore│  │
│  │ (export 图) │   │ (AssetCard)  │   │ (md + upsert)        │  │
│  └─────────────┘   └──────────────┘   └─────────────────────┘  │
│         ↑ git diff（增量）              last-scan.json           │
└────────────────────────────┬─────────────────────────────────────┘
                             │ 读写
┌────────────────────────────▼─────────────────────────────────────┐
│  .ai/arch/                                                        │
│  arch-index.json | **/*.md | vectors.db | last-scan.json        │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│  MCP: query_arch | search_arch | register_asset | register_contract │
└──────────────────────────────────────────────────────────────────┘
```

### 3.1 Agent 推荐流程（v2）

1. 模糊找能力 → `search_arch(query, filter?)`
2. 锁定条目 → `query_arch(path#anchor)` 或 `search_arch` 返回的 `path`
3. 写 TS 集成代码 → `query_contract(name)`
4. 开发完成 → `register_contract`（契约）+ `register_asset`（架构资产）

---

## 4. 统一资产模型 AssetCard

所有扫描器与 `register_asset` 输出统一结构：

```typescript
interface AssetCard {
  id: string;              // 稳定 ID: "backend/base-common/util/JsonUtils"
  kind: "api" | "rpc" | "component" | "util" | "enum" | "starter" | "pojo" | "contract";
  name: string;
  module: string;          // Maven slug 或 npm package slug
  path: string;            // 源码相对项目根路径
  summary: string;         // 一句话
  whenToUse: string;       // 何时用、解决什么问题
  howToUse: string;        // import、依赖声明、调用示例
  exports: string[];       // 对外 API / 方法 / 枚举成员摘要
  related: string[];       // 关联 asset id
  tags: string[];
  source: "scan" | "register";
  updatedAt: string;       // ISO8601
}
```

**Embedding 文本模板**（写入 chunk `text`）：

```
[{kind}] {name} @ {module}
Summary: {summary}
When to use: {whenToUse}
How to use: {howToUse}
Exports: {exports.join(", ")}
Tags: {tags.join(", ")}
Source path: {path}
```

**Chunk `kind` 扩展：** 在现有 `api|rpc|component|util|enum|overview|convention` 上增加 `starter`、`pojo`。

---

## 5. 发现层（Discovery）

不依赖固定目录，按语言/形态规则从源码提取**候选资产**，再交给 AI 总结。

### 5.1 Java / Spring

| 候选类型 | 发现规则 |
|----------|----------|
| API | 现有逻辑 + OpenAPI 优先 merge |
| RPC | `@FeignClient`：**同时支持** `name=`、`value=`、常量引用（解析失败时保留接口名 + 方法签名） |
| Util | `public class *Utils`、`*Helper`；`util/` 包下 public 类 |
| Enum | `public enum` + Javadoc |
| POJO | `*DTO`、`*Req`、`*Resp`、`*Param`、`*Result`；`pojo/` 包 |
| Starter | Maven artifactId 匹配 `*-starter`；读 `@Configuration`、`spring.factories`、`AutoConfiguration.imports` |
| Constants | `*Constants`、错误码类 |

**模块边界：** 沿用 `findMavenModules()`；每个 module 独立批处理。

**Backend 公共库（如 base-common）：** 无 Controller 时仍产出 `utils.md`、`enums.md`、`pojo.md`、`rpc.md`（CommonApi）、`constants.md`。

### 5.2 前端 TS/Vue/React

| 候选类型 | 发现规则 |
|----------|----------|
| Component | export 图：PascalCase + `.tsx/.vue` SFC + 含 props/defineProps |
| Util | camelCase 函数 export、`*Utils.ts`、纯函数模块 |
| Enum | `export enum`、const enum、as const 对象（可选 v2.1） |
| Starter/UI 包 | `package.json` 中 `"name": "@scope/ui"` 或 config 标记的 design-system 包；包级 Card + 子 component |

**Package 边界：** workspace 包 + 独立 frontend 应用；递归 `src/**` 而非固定 `src/components`。

### 5.3 OpenAPI / Apifox

保持 v1：`apiSpecGlobs` 优先；与 Java 注解 dedupe（同 method+path 保留 OpenAPI）。

---

## 6. AI 总结层

### 6.1 输入

每个候选附带：文件路径、类/符号名、Javadoc/TSDoc、public 方法签名列表、关键注解（Feign mapping、Component props 等）。

### 6.2 输出

严格 JSON AssetCard（缺字段时 AI 填「暂无」而非省略键）。

### 6.3 批处理策略

| 粒度 | 规则 |
|------|------|
| 模块/包 | 一次处理一个 Maven module 或 npm package |
| 批大小 | 每批最多 **20** 个候选（可配置 `arch.config.json` → `summarize.batchSize`） |
| 顺序 | backend modules（拓扑/字母序）→ frontend packages → openapi 全局 API |
| 失败 | 单批失败 retry 1 次；仍失败则写「待人工补充」占位 Card（summary=扫描失败），**不** silent skip |
| Token | 超大类（如 `CollectionUtils`）只送 public 方法签名 + 类 Javadoc，不送全文件 |

### 6.3 配置

复用 `arch.config.json` 的 `chunking` LLM 配置做 summarize；或新增 `summarize` 段（推荐分离 chatModel 与 chunking）。

---

## 7. 写入层

### 7.1 Markdown 树（按 module/package）

```
.ai/arch/
├── backend/<module-slug>/
│   ├── overview.md      # AI 模块摘要
│   ├── api.md
│   ├── rpc.md
│   ├── utils.md         # 新增
│   ├── enums.md         # 新增
│   ├── pojo.md          # 新增
│   ├── constants.md     # 新增（可选）
│   └── starter.md       # *-starter 模块
├── frontend/<pkg-slug>/
│   ├── overview.md
│   ├── components.md
│   ├── utils.md
│   ├── enums.md
│   └── starter.md       # UI 基础包
├── arch-index.json
├── vectors.db
└── last-scan.json
```

每条 AssetCard 在对应 md 中渲染为带 anchor 的条目（`## {name}` + 字段表）。

### 7.2 向量库 upsert

- **Chunk id** = AssetCard.id（稳定）
- **全量 init：** 清空 module 级 chunks 后重写（批内 upsert）
- **增量：** 按变更文件反查 asset id，delete-by-id 后 re-embed 新 Card
- **register_asset：** 直接 upsert 单条

`VectorStore` 新增：`upsertChunks(chunks)`、`deleteByIds(ids)`、`deleteByModule(module)`。

### 7.3 arch-index.json

节点增加 `kinds` 计数；INDEX 表增加 Utils/Enums/POJO/Starter 列（与 v1 前端 enums 扩展一致）。

---

## 8. 模块分批与增量（第三节核心）

### 8.1 首次全量 `start-init`

```
1. loadOrInitConfig → assertValidConfig → resolveApiKey（失败 exit 1）
2. discovery 全项目 → DocumentModel + RawCandidates[]
3. FOR each module/package IN order:
     a. AI summarize 该模块全部 candidates（分批）
     b. writeMarkdownTree(module)
     c. buildChunksFromAssetCards → embed → upsert vectors
     d. log progress; optional GC
4. merge openapi APIs（全局）
5. writeArchIndex + writeIndexMd（arch 部分）
6. write last-scan.json
```

**不**在步骤 3 之前 `cleanArchDir` 全删；改为：

- 首次无 `last-scan.json`：清空 `vectors.db` + arch 子目录（保留 config/secrets）
- 或 CLI 显式 `--full`（默认首次行为）

### 8.2 `last-scan.json`  schema

```json
{
  "version": 2,
  "commit": "abc123...",
  "branch": "main",
  "scannedAt": "2026-06-02T12:00:00.000Z",
  "modules": {
    "base-common": {
      "sourcePath": "base/base-framework/base-common",
      "assetCount": 52,
      "fileHashes": {}
    }
  },
  "packages": {}
}
```

- `commit`：扫描完成时的 `git rev-parse HEAD`（非 git 仓库则 `"nogit"` + 全量 hash 清单 fallback）
- `fileHashes`：可选；git 不可用时的 fallback（path → sha256）

### 8.3 增量 `start-init`

```
1. read last-scan.json；若无 → 走全量
2. git diff last-scan.commit..HEAD --name-only
3. 映射变更文件 → affected modules/packages
4. 仅对 affected 重新 discovery + AI summarize + md/vector upsert
5. 更新 last-scan.json.commit
```

**CLI：** `start-init` 默认增量；`start-init --full` 强制全量。

**未变更模块：** markdown 与 vectors 保留不动。

### 8.4 Git 边界情况

| 情况 | 行为 |
|------|------|
| 非 git 仓库 | 使用 `fileHashes` 全量对比；无 last-scan 则全量 |
| commit 不可达（rebase） | 警告 + 降级全量 |
| 仅 `.ai/` 变更 | 忽略，不触发 rescan |

---

## 9. MCP：`register_asset`

### 9.1 工具签名

```typescript
register_asset({
  kind: "component" | "util" | "enum" | "starter" | "api" | "rpc" | "pojo",
  name: string,
  module: string,           // slug，如 "ui" 或 "base-common"
  sourcePath: string,       // 相对项目根的源码文件
  summary: string,
  whenToUse: string,
  howToUse: string,
  exports?: string[],
  related?: string[],
  tags?: string[]
})
```

### 9.2 服务端行为

1. 校验 `sourcePath` 存在
2. 生成 `id`（与扫描器规则一致，避免重复）
3. 构建 AssetCard（`source: "register"`）
4. upsert 对应 markdown 条目（追加或替换 anchor）
5. embed + upsert `vectors.db`
6. 更新 `arch-index.json` 节点计数
7. 返回 `{ ok: true, id, path }`（arch 文档 path，供 `query_arch`）

### 9.3 与 `register_contract` 分工

| 工具 | 存储 | 用途 |
|------|------|------|
| `register_contract` | `.ai/db.json` + `.ai/INDEX.md` | TS 类型契约 |
| `register_asset` | `.ai/arch/**` + `vectors.db` | 可复用架构资产语义检索 |

---

## 10. `/finish-feature` 模板（v2）

```markdown
## 闭环注册（必须）

### TS 契约（若有对外 TS 类型）
- 调用 `register_contract`

### 架构资产（若有新建/显著修改）
以下任一项必须调用 `register_asset`：
- 新组件、工具函数、枚举
- 新 Feign/CommonApi、对外 REST 接口
- 新 starter 模块或 UI 基础包导出

传入：kind, name, module, sourcePath, summary, whenToUse, howToUse, exports, tags

### 验证
- `search_arch` 用自然语言能搜到刚注册的资产
```

---

## 11. `search_arch` 扩展

- `filter.kind` 增加：`starter`、`pojo`
- 返回结果增加 `assetId`、`sourcePath` 字段（便于 Agent 跳转源码）

---

## 12. 错误处理

| 场景 | 行为 |
|------|------|
| Embedding API 失败 | exit 1，不更新 last-scan |
| AI summarize 单批失败 | retry 1 次 → 占位 Card → 继续下一批；最终报告 warnings |
| 源码文件删除 | 增量时 remove 对应 asset id（md + vector） |
| register_asset 重复 id | upsert 覆盖 |

---

## 13. 测试策略

### 13.1 单元测试（arch-engine）

- Java discovery：`@FeignClient(name=)`、`Utils`、enum、DTO、starter 识别
- TS discovery：export 图组件/util/enum
- AssetCard → chunk 文本格式
- last-scan diff 映射逻辑
- VectorStore upsert/delete

### 13.2 夹具

- 最小 Maven module（含 CommonApi + Utils + enum）
- 最小 frontend package（Button + util + enum）

### 13.3 集成验收（chongqing）

| 查询 | 期望 top 结果 |
|------|----------------|
| `通用状态枚举` | `CommonStatusEnum` |
| `JSON 工具类` | `JsonUtils` |
| `字典数据 RPC` | `DictDataCommonApi` |
| `分页参数` | `PageParam` |

---

## 14. 实现分期（供 writing-plans 展开）

| 阶段 | 交付物 | 可独立验收 |
|------|--------|------------|
| **P1 发现 + 写入** | Java/TS discovery v2、md Writer、Feign fix | chongqing 全量 md 含 utils/enums/rpc |
| **P2 AI + 向量** | Summarize 批处理、AssetCard pipeline、embed upsert | vectors.db 可 search 命中 base-common |
| **P3 增量** | last-scan.json、git diff、增量 upsert | 改一个 Utils 后增量 init 只更新该 module |
| **P4 MCP 闭环** | `register_asset`、finish-feature、search_arch 扩展 | finish-feature 注册后立刻 searchable |
| **P5 Starter** | `*-starter` + UI 包 | starter.md + search |

**原则：** P2 完成前不对外宣称 v2 可用；P4 完成后才算「能用的组件」。

---

## 15. 非目标（v2 不做）

- Go/Python 源码扫描
- 自动从 Java 生成 TS 契约（仍靠人工 + register_contract）
- 替换 Apifox/CI 文档流水线
- 无 git 时的完美增量（仅 hash fallback）

---

## 16. 开放问题（实现前默认）

| 问题 | 默认 |
|------|------|
| Summarize 与 chunking 共用同一 LLM？ | 共用 `chunking` 配置，后续可拆分 |
| AI 总结语言 | 中文（与项目 Javadoc 一致） |
| starter 子组件深度 | UI 包扫描 `exports` + 一级子目录，不递归 node_modules |

---

## 17. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-06-02 | 初稿：v2 全量设计，含 AssetCard、增量、register_asset、分批策略 |
| 2026-06-02 | 实现完成：SA-1～SA-5 子 Agent 交付，arch-engine 86 tests、mcp-server 24 tests |
| 2026-06-02 | SA-6 Starter A+B：java-starter、frontend-starter、designSystemPackages，92 tests |
