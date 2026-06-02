# Arch Bootstrap 设计规格

**日期:** 2026-06-01  
**状态:** 已批准  
**命令名:** `start-init`（主名；`stack-init` 不作为对外主名）  
**关系:** APT（Agent-Protocol-Toolkit）扩展能力

---

## 1. 背景与目标

APT v1 提供扁平 TS 契约注册（`query_contract` / `register_contract`）与 `/start-feature`、`/finish-feature` 流程。大型 monorepo 仍存在：

- 架构文档过大（如 1000+ 行 ALL-IN-ONE），子 Agent 不应整份读取
- 模块、API（HTTP vs RPC）、公共组件、前端规范分散在代码与导出文件中
- 仅靠路径无法完成「模糊发现」（如「找一个发通知的能力」）

**Arch Bootstrap** 通过 `start-init` 全自动扫描项目，生成多级架构文档 + 向量索引，供 MCP 分级查询与语义检索，与现有契约工具职责分离。

**成功标准：**

- 任意项目根执行 `start-init` 后生成完整 `.ai/arch/**` 与 `vectors.db`
- Agent 用 `search_arch("用户登录")` 在 top-3 命中正确 API
- Agent 用 `query_arch("backend/<module>/api#...")` 精读单条，上下文可控
- 开发阶段仍用 `query_contract` 查 TS 类型
- macOS / Windows 均可 install 并使用
- 无有效 Embedding 配置时 **exit 1**，不产出「无向量半成品」

---

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 生成方式 | 全自动扫描 |
| 适用范围 | 跨项目通用（不绑定单一 monorepo） |
| v1 扫描栈 | Java 多模块 + OpenAPI/Swagger/Apifox JSON + 前端 npm/pnpm workspace |
| API 文档优先级 | 存在 Apifox/Swagger 导出 JSON 时优先于纯 Java 注解扫描 |
| 查询模型 | 多级路径 `query_arch` + 向量 `search_arch` + 契约 `query_contract` 分离 |
| 重复执行 | 全量覆盖（文档 + 向量库一并重建） |
| Embedding | OpenAI 兼容 API（可配置 `baseUrl`） |
| 分片 | 语义分片；禁止定长字符/Token 切块 |
| 主命令名 | **`start-init`** |

---

## 3. 架构

### 3.1 组件图

```
┌─────────────────────────────────────────────────────────────┐
│  Custom Commands (.claude/commands/)                        │
│  /start-feature  /finish-feature  (+ start-init 使用说明)   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  start-init CLI (~/.apt/bin/)                               │
│  JavaScanner | OpenApiScanner | FrontendScanner             │
│  → DocumentModel → MarkdownWriter                           │
│  → SemanticChunker (LLM) → EmbeddingProvider → VectorStore  │
└───────────────────────────┬─────────────────────────────────┘
                            │ 写入
┌───────────────────────────▼─────────────────────────────────┐
│  .ai/arch/  arch-index.json | **/*.md | vectors.db          │
└───────────────────────────┬─────────────────────────────────┘
                            │ 读写
┌───────────────────────────▼─────────────────────────────────┐
│  MCP agent-protocol-mcp                                     │
│  query_arch | search_arch | query_contract | ...            │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 与现有 APT 分工

| 场景 | 工具 |
|------|------|
| 模糊发现模块/API/组件 | `search_arch(query)` |
| 浏览与精读架构文档 | `query_arch(path)` |
| 开发前查 TS 类型契约 | `query_contract(name)` |
| 完成后注册新契约 | `register_contract` |
| 依赖缺失阻塞 | `report_missing` |

**Agent 推荐流程：**

1. 依赖不明确 → `search_arch`
2. 锁定 path → `query_arch` 精读
3. 写代码前 → `query_contract`

### 3.3 源码布局（本仓库）

```
claude_plugin/
├── arch-engine/              # 新增：扫描、分片、向量、索引（CLI + MCP 共用）
│   ├── src/
│   │   ├── scanners/
│   │   │   ├── java.ts
│   │   │   ├── openapi.ts    # OpenAPI 3 + Apifox 导出 JSON
│   │   │   └── frontend.ts
│   │   ├── chunking/
│   │   │   └── semantic.ts   # L1 结构化 + L2/L3 LLM 语义分片
│   │   ├── embedding/
│   │   │   └── openai-compatible.ts
│   │   ├── vector/
│   │   │   └── sqlite-vec.ts
│   │   ├── index/
│   │   │   ├── arch-index.ts
│   │   │   └── markdown-writer.ts
│   │   └── cli.ts            # start-init 入口
│   └── tests/
├── mcp-server/src/
│   ├── arch-query.ts         # query_arch, search_arch
│   └── index.ts              # 注册新 tools
├── bin/
│   ├── start-init.sh
│   ├── start-init.ps1
│   └── start-init.cmd
└── templates/
    └── start-feature.md      # 更新：search_arch + query_arch
```

---

## 4. 项目数据模型

### 4.1 目录结构（目标项目）

```
<project>/
├── .ai/
│   ├── db.json                      # agent-init；契约库
│   ├── INDEX.md                     # register_contract 生成
│   └── arch/
│       ├── arch.config.json         # 用户配置（API、glob、扫描开关）
│       ├── arch-index.json          # 机器可读树 + chunk 映射
│       ├── vectors.db               # SQLite 向量库（全量重建）
│       ├── INDEX.md                 # 人类可读总览（自动生成）
│       ├── backend/
│       │   └── <module-slug>/
│       │       ├── overview.md
│       │       ├── api.md           # HTTP / 面向前端或 BFF
│       │       └── rpc.md           # Feign / Dubbo 等内部 RPC
│       └── frontend/
│           └── <package-slug>/
│               ├── overview.md      # 技术栈、包命名、目录约定
│               ├── components.md
│               └── utils.md
```

### 4.2 `arch-index.json` 节点

```typescript
interface ArchIndexNode {
  path: string;           // 如 "backend/base-module-system/api"
  kind: "root" | "module" | "api-doc" | "component-doc" | "package";
  title: string;
  summary: string;
  children: string[];       // 子 path 列表
  docFile?: string;       // 相对 .ai/arch/ 的 md 路径
  chunks: string[];       // chunk UUID 列表
  keywords: string[];     // 检索辅助
  anchors?: string[];     // md 内 ## 锚点
}
```

### 4.3 Chunk 记录（vectors.db + 元数据）

```typescript
interface ArchChunk {
  id: string;
  path: string;           // 关联 arch-index path
  anchor?: string;
  kind: "api" | "rpc" | "component" | "util" | "overview" | "convention";
  title: string;
  text: string;           // 用于 embedding 的完整语义单元
  embedding?: Float32Array; // 库内存储
}
```

---

## 5. `arch.config.json`

首次 `start-init` 若不存在，写入模板并 **exit 0 + 提示用户填写 API Key 相关 env 后重跑**；第二次起执行完整流水线。

```json
{
  "embedding": {
    "baseUrl": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "model": "text-embedding-3-small"
  },
  "chunking": {
    "baseUrl": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "chatModel": "gpt-4o-mini",
    "maxChunkTokens": 800,
    "strategy": "semantic-only"
  },
  "apiSpecGlobs": [
    "docs/**/*.json",
    "**/openapi.json",
    "**/swagger.json"
  ],
  "scanners": {
    "java": true,
    "frontend": true
  }
}
```

- `baseUrl` 兼容 OpenAI 协议网关（阿里、DeepSeek 等）
- `apiKeyEnv` 指向环境变量名，**不在文件中写明文 key**

---

## 6. `start-init` 流水线

1. 解析 `process.cwd()` 为项目根
2. 加载或初始化 `arch.config.json`
3. **清空** `.ai/arch/` 下生成物（**保留** `arch.config.json`）
4. 并行扫描：
   - **JavaScanner:** `pom.xml` / 多模块结构；`@RestController` → api；`@FeignClient` / Dubbo 注解 → rpc
   - **OpenApiScanner:** 匹配 `apiSpecGlobs`；解析 OpenAPI 3 与 Apifox 导出 JSON（paths、tags、operationId、parameters）
   - **FrontendScanner:** workspace `package.json`；`src/components`、`src/utils` 或约定目录索引
5. **合并规则:** 同一 API 若 OpenAPI 与 Java 扫描重复，**以 OpenAPI/Apifox 为准**
6. 渲染 Markdown 树 + 生成 `arch-index.json` 骨架
7. **语义分片**（见 §7）
8. **Embedding** 批量写入 `vectors.db`
9. 生成 `INDEX.md` 人类总览
10.  stdout 报告：模块数、API 数、chunk 数、耗时；stderr 列出扫描 warning

**CLI 退出码:**

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 向量/embedding 失败（不允许部分成功） |
| 2 | 配置错误 |

---

## 7. 语义分片策略

**禁止:** 固定字符长度或固定 token 窗口滑动切片。

**三级策略:**

| 层级 | 输入 | 行为 |
|------|------|------|
| **L1 结构化** | 扫描器实体 | 每个 API、RPC、组件、util = **1 chunk** |
| **L2 文档级** | overview 等长 md | Chat 模型输出 JSON：`[{title, text, keywords}]`，按主题边界切分 |
| **L3 超长段** | 单段仍 > `maxChunkTokens` | 再次 LLM 语义拆分，直至满足上限 |

**L2/L3 LLM 输出约束:**

- 每段可独立回答「是什么、给谁用、怎么用」
- 不得从句子中间截断
- 写入 `keywords` 供 `arch-index.json`

**Embedding 输入格式（增强检索）:**

```
[kind:api][module:base-module-system][tags:auth,frontend-facing]
POST /system/auth/login — 用户登录
Parameters: ...
Response: ...
```

---

## 8. 扫描器规范（v1）

### 8.1 JavaScanner

- 发现: 含 `pom.xml` 的子目录或 Maven reactor 模块名
- HTTP API: `@RequestMapping` / `@GetMapping` 等 + 类级路径
- RPC: `@FeignClient`、Dubbo `@Service`（若存在）
- 输出 `kind`: `frontend-facing` vs `internal` 启发式：
  - 路径含 `/admin/`、`/internal/` → internal
  - 位于 `*-api` 公开模块且 OpenAPI 标记 → 按 OpenAPI

### 8.2 OpenApiScanner

- 支持 OpenAPI 3.x JSON/YAML
- Apifox 导出: 识别 `openapi` 字段或 Apifox 常见 wrapper（v1 实现时以 fixture 锁定格式）
- 提取: method、path、summary、tags、parameters、requestBody、responses

### 8.3 FrontendScanner

- pnpm/npm/yarn workspaces
- 每 package: `name`、`description`、依赖、框架（vue/react 从 deps 推断）
- 索引 `components/`、`utils/` 下导出符号（文件名 + 导出名，v1 不解析 AST）

---

## 9. MCP Tools

### 9.1 `query_arch`

| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | string? | 空 = 根；如 `backend/base-module-system`；支持 `#anchor` |

**返回:**

- `summary`、`kind`、`children[]`（path + title + one-line）
- 若含 anchor：对应 md 章节正文（单节，控制长度）

**错误:**

- path 不存在 → 建议 `search_arch`
- `.ai/arch` 不存在 → 提示运行 `start-init`

### 9.2 `search_arch`

| 参数 | 类型 | 说明 |
|------|------|------|
| `query` | string | 自然语言或关键词 |
| `limit` | number? | 默认 5 |
| `filter` | object? | `{ kind?: "api"|"rpc"|"component"|"module" }` |

**返回:** `[{ path, anchor?, score, summary, kind }]` — **不含全文**

**逻辑:** embed query → sqlite-vec top-K → 按 score 降序

### 9.3 现有 tools

`query_contract`、`register_contract`、`report_missing` 行为不变。

---

## 10. 安装与部署

- `scripts/install.sh` / `install.ps1` 扩展：
  - 构建 `arch-engine`
  - 复制 `start-init` 到 `~/.apt/bin`
  - MCP 仍注册 `agent-protocol-mcp`（含新 tools）
- PATH 与现有 `agent-init` 一致

**前置条件（文档/README）:**

- Node.js 18+
- 环境变量 `OPENAI_API_KEY`（或 `arch.config.json` 指定之名）
- 已 `agent-init`（若需 commands + 契约库）

**推荐使用顺序:**

1. `agent-init` — 注入 commands + 空 `db.json`
2. `start-init` — 架构文档 + 向量库
3. 重启 Claude Code

---

## 11. 失败策略与约束

| 情况 | 行为 |
|------|------|
| 缺少 API Key | embedding 步骤失败，**exit 1**，不保留旧 vectors.db |
| 单模块 Java 扫描失败 | warning，继续其他模块 |
| OpenAPI JSON 解析失败 | warning，跳过该文件 |
| Embedding API 429/5xx | 指数退避重试 3 次，仍失败则 exit 1 |
| 项目无任何可扫描内容 | 生成空 INDEX + 空向量库，exit 0，stdout 警告 |

**安全:**

- TS/API 路径解析沿用 APT `resolveTsPath` 规则（禁止路径穿越）
- `vectors.db` 仅本地存储，不上传

---

## 12. `/start-feature` 模板更新

在现有步骤前增加:

1. 对不明确的依赖，**必须先** `search_arch`
2. 对每个候选依赖 **必须** `query_arch` 精读
3. TS 类型 **必须** `query_contract`（与现规则一致）

---

## 13. 测试与验收

**单元测试:**

- 各 Scanner fixture（Java pom、OpenAPI、Apifox JSON、pnpm workspace）
- SemanticChunker mock LLM 响应
- VectorStore insert/search
- `query_arch` / `search_arch` 处理器

**集成测试:**

- 临时目录 synthetic monorepo → `start-init` → assert files + search hit

**验收（人工）:**

- 中等规模 monorepo `start-init` < 5 分钟
- `search_arch("登录")` top-3 含预期 API
- `query_arch` 单节 < ~2k tokens

---

## 14. v1 明确不做

- 向量以外的关键词倒排索引（向量即主检索通道）
- 增量合并 / 手工段落保护
- TS AST 解析
- 非 OpenAI 兼容 Embedding 协议（v2 可加 Ollama provider）
- 远程向量库（Pinecone 等）

---

## 15. 版本演进（非 v1）

- v2: Ollama / 本地 Embedding provider
- v2: `start-init` 后自动从 OpenAPI 生成 TS 契约草稿并 `register_contract`
- v2: CI 钩子定期重建 arch 索引
