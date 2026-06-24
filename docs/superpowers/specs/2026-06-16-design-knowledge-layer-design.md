# Design Knowledge Layer（设计知识层）设计规格

> **补齐规格：** Phase 1–3 完整愿景与波次交付见 [2026-06-24-design-knowledge-layer-completion-design.md](./2026-06-24-design-knowledge-layer-completion-design.md)。

**日期:** 2026-06-16  
**状态:** 已批准（brainstorming 三节，待用户审阅 spec 文件）  
**关系:** 扩展 APT `/feature` 寻址闭环；与 `.ai/arch/` 并行，不合并  
**痛点:** 设计阶段（baoyu-design / 其它工具）产出的风格无法被开发子 agent 硬约束查询；前端实现易臆造 UI  

---

## 1. 背景与问题

### 1.1 现状

| 层级 | 能力 | 缺口 |
|------|------|------|
| **baoyu-design** | HTML 原型、设计系统、`_ds_prompt`、handoff 包 | 产出在 `designs/`，**未进入** APT MCP 寻址 |
| **APT `/feature`** | `query_contract` → `search_arch` → 实现 → arch 闭环 | **无**「本页用什么风格 / 什么语义组件」查询 |
| **`start-init`** | 扫描仓库内 design-system **代码包** | 不管线框、高保真、baoyu 语义组件 |

### 1.2 目标

1. **工具无关**：baoyu-design、Figma、其它设计插件均可作为「设计生产层」；开发子 agent **只查** 项目内沉淀的设计知识。
2. **框架无关（C）**：`.ai/design/` 存 tokens + 语义组件 + 页面配方；React/Vue 通过可选 `framework-bindings.json` 后期绑定。
3. **硬约束**：有 UI 的前端任务必须先 `query_design` / `search_ui`；缺定义则 `report_design_gap` 并停止 UI 实现（对标 `report_missing`）。
4. **与 arch 对称**：`design-sync` 管视觉真源，`start-init` 管代码架构真源；互不覆盖。

### 1.3 非目标（YAGNI）

- MVP 不做 Figma ingest、不做 design 向量库（Phase 2）。
- MVP 不做 `register_ui_pattern`、design-vs-implementation audit（Phase 3）。
- 不把设计 HTML 原型直接当生产代码复制（仍走语义 + tokens + bindings 重建）。
- 不合并 `.ai/design/` 与 `.ai/arch/` 为单一索引。

---

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 集成方案 | **方案 1**：APT Design Knowledge Layer（`.ai/design/` + MCP） |
| 设计真源 | 定稿后 **`design-sync` ingest** 写入 `.ai/design/`；子 agent 不直接读 `designs/` |
| 技术栈 | **C — 多栈 / 框架解耦**；bindings 可选、后置 |
| 寻址顺序 | **先 design → 再 contract/arch**（仅含 UI 的任务执行 §0.5） |
| baoyu 角色 | 第一个 ingest 适配器，非唯一供应商 |
| 阻塞策略 | 无 `.ai/design/` 或缺组件定义 → 报错 / `report_design_gap`，禁止臆造视觉 |

---

## 3. 架构总览

### 3.1 三层模型

```
┌─────────────────────────────────────────────────────────┐
│  设计生产层（可换工具）                                    │
│  baoyu-design / Figma / 其它 → designs/ 或外部产物        │
└───────────────────────┬─────────────────────────────────┘
                        │ design-sync（ingest 适配器）
                        ▼
┌─────────────────────────────────────────────────────────┐
│  设计知识层 .ai/design/  （框架无关，项目真源）             │
│  profile · tokens · components · pages · style.md        │
└───────────────────────┬─────────────────────────────────┘
                        │ query_design / search_ui (MCP)
                        ▼
┌─────────────────────────────────────────────────────────┐
│  实现层（可选，按项目加）                                   │
│  framework-bindings.json  → React / Vue / 自研 UI 库     │
└─────────────────────────────────────────────────────────┘
```

### 3.2 与 APT 生命周期

```
立项     /design-system  →  设计工具定风格  →  design-sync  →  .ai/design/
扫代码   start-init      →  .ai/arch/
开发     /feature        →  query_design → query_contract/search_arch → 实现
收尾     audit/refresh   →  .ai/arch/  （arch 闭环不变）
```

### 3.3 语义模型（框架无关）

开发子 agent 依赖三类查询结果：

| 类型 | MCP | 内容 |
|------|-----|------|
| **Global** | `query_design({ scope: "global" })` | tokens + `style.md` 绑定约束 + 禁用项 |
| **Component** | `query_design({ component: id })` 或 `search_ui` | 语义组件：anatomy、states、tokenRefs、constraints |
| **Page** | `query_design({ page: slug })` | 页面配方：布局区块、组件组合、空态/加载态 |

**语义组件卡片（示例字段）：**

```json
{
  "id": "PrimaryButton",
  "role": "main-action",
  "anatomy": ["label", "optional-icon", "loading-indicator"],
  "states": ["default", "hover", "disabled", "loading"],
  "tokenRefs": ["color.primary", "radius.md", "spacing.button-padding"],
  "constraints": ["单屏最多一个 PrimaryButton"],
  "refPaths": ["refs/onboarding.html#cta"]
}
```

**framework-bindings.json（可选，Phase 2）：**

```json
{
  "PrimaryButton": {
    "react": { "import": "@org/ui/Button", "props": { "variant": "primary" } },
    "vue": { "import": "@org/ui/Button", "props": { "type": "primary" } }
  }
}
```

无 bindings 时：子 agent 用语义结构 + tokens 实现，**禁止**自造 hex/字号/圆角。

---

## 4. `.ai/design/` 目录与 Schema

### 4.1 目录结构

```
.ai/design/
├── profile.json              # 版本、来源、sync 时间、warnings
├── style.md                  # 绑定视觉约束（蒸馏自设计系统 prompt）
├── tokens/
│   ├── colors.json
│   ├── typography.json
│   ├── spacing.json
│   └── radii.json            # 等，按 ingest 拆分
├── components/
│   └── <SemanticId>.json
├── pages/
│   └── <page-slug>.json      # 可选
├── refs/                     # 原型 HTML/截图路径（引用，不嵌入向量）
│   └── ...
└── framework-bindings.json   # 可选；Phase 2
```

### 4.2 profile.json（v1 要点）

```json
{
  "version": 1,
  "primarySource": { "tool": "baoyu-design", "path": "designs/acme-app" },
  "sources": [],
  "syncedAt": "2026-06-16T12:00:00.000Z",
  "componentCount": 12,
  "pageCount": 3,
  "warnings": []
}
```

### 4.3 page 配方（v1 要点）

```json
{
  "id": "user-settings",
  "title": "用户设置",
  "regions": [
    { "id": "header", "components": ["PageHeader"] },
    { "id": "actions", "components": ["PrimaryButton", "SecondaryButton"] }
  ],
  "states": { "loading": "SkeletonList", "empty": "EmptyState" },
  "refPaths": ["refs/user-settings.html"]
}
```

---

## 5. Ingest：`design-sync`

### 5.1 CLI

```bash
design-sync [--source designs/<project>] [--dry-run] [--pages-only] [--incremental]
```

| 标志 | 行为 |
|------|------|
| `--dry-run` | 报告将写入的文件，不改盘 |
| `--pages-only` | 仅更新 `pages/` 与 `refs/` |
| `--incremental` | 按来源 mtime 增量更新（Phase 2） |

### 5.2 baoyu 适配器（MVP 唯一适配器）

| baoyu 来源 | 写入目标 |
|------------|----------|
| `_ds/<slug>/_ds_manifest.json` | `profile.json`、组件 id 清单 |
| CSS `:root` / token allowlist | `tokens/*.json` |
| `<Component>.prompt.md` | `components/<SemanticId>.json` |
| `_ds/<slug>/_ds_prompt.md` | `style.md` |
| `record-asset` 页面资产 | `pages/<slug>.json` + `refs/` 链接 |
| `_d_meta.json` | `profile.sources[]` |

### 5.3 触发时机

| 时机 | 动作 |
|------|------|
| 立项定风格后 | `design-sync` 全量 |
| baoyu 更新 DS 或新页面定稿 | `design-sync`（增量 Phase 2） |
| 开发前自检 | `query_design` 返回 `stale: true` 时提示重跑 sync |

---

## 6. MCP 工具

| 工具 | 说明 |
|------|------|
| **`query_design`** | `scope: "global"` \| `page: "<slug>"` \| `component: "<id>"` |
| **`search_ui`** | 语义/关键词搜组件与页面配方；MVP 为 JSON + 关键词，Phase 2 加向量 |
| **`report_design_gap`** | 缺设计定义时阻塞；字段 `need`, `page?`, `reason` |

### 6.1 错误类型

| 错误 | 条件 | 消息要点 |
|------|------|----------|
| `MissingDesignProfileError` | 无 `.ai/design/profile.json` | Run `design-sync` or `/design-system` first |
| `DesignComponentNotFoundError` | 未知 component id | 建议 `search_ui` 或 `report_design_gap` |
| 响应 `gaps[]` | 页面配方引用未 ingest 的组件 | ingest warnings 或补 design |

### 6.2 与 arch 冲突规则

- **design** 决定外观与语义组件选择。
- **arch** 决定 API、工具类、模块边界与 `sourcePath`。
- 同名不同域不合并（例：arch 的 `Button` util ≠ design 的 `PrimaryButton` 语义组件）。

---

## 7. 命令与模板

### 7.1 斜杠命令

| 命令 | 阶段 | 说明 |
|------|------|------|
| **`/design-system`**（新） | 立项 | 引导设计工具定风格 → 定稿 → `design-sync` |
| **`/design-page`**（新，Phase 2） | 单页 | 单页原型定稿 → `design-sync --pages-only` |
| **`/feature`**（改） | 开发 | 增加 §0.5 设计寻址 |

### 7.2 `/feature` §0.5 设计寻址（有 UI 则必须）

```
1. query_design(scope: global)
2. query_design(page: <本页>) ；无则 search_ui 找最近模板
3. 列出 semantic components → 逐个 query_design(component: id)
4. 缺定义 → report_design_gap，停止 UI（可先写接口/逻辑）
5. 有 framework-bindings.json → 读映射；无则 tokens + 语义结构
```

原有 §1 契约/arch 寻址、§3 arch 闭环**不变**。

### 7.3 baoyu-skills 分工

| 阶段 | 工具 | 进入 MCP？ |
|------|------|------------|
| 设计探索 / 配图 / 图表 | baoyu-diagram、baoyu-image-gen 等 | 否；产物若影响 tokens 需重新 `design-sync` |
| 设计系统 / 高保真 | baoyu-design | 否；定稿后 `design-sync` |
| 前端实现 | `/feature` + MCP | 是 |

---

## 8. 错误处理汇总

| 场景 | 行为 |
|------|------|
| 无 `.ai/design/` | MCP 抛 `MissingDesignProfileError` |
| ingest 来源损坏 | `design-sync` 非零退出；`--dry-run` 仅报告 |
| 页面配方引用未知组件 | ingest `warnings[]`；运行时 `gaps[]` |
| 子 agent 缺组件 | `report_design_gap`，禁止自造视觉 |
| 无 `framework-bindings.json` | 不阻塞 |
| `designs/` 新于 `.ai/design/` | `query_design` 带 `stale: true` |

---

## 9. 测试策略

### 9.1 design-engine（新模块或包）

- JSON schema 校验：`profile`、`components/*`、`tokens/*`
- baoyu 夹具 ingest → `.ai/design/` 快照测试
- 增量 sync（Phase 2）：单 token 变更仅更新对应文件

### 9.2 mcp-server

- `query_design` / `search_ui` 集成测试（临时目录 + 夹具 profile）
- 无 profile 时错误信息与 `MissingDesignProfileError` 一致

### 9.3 狗食验收（MVP）

1. `/design-system` + baoyu 定最小 DS（3 组件 + tokens）
2. `design-sync`
3. `/feature` 实现一页
4. 页面 CSS/组件符合 tokens；无随意 hex；缺组件时 agent 阻塞而非瞎写

---

## 10. 分阶段落地

### Phase 0 — 约定先行（1–2 天，可零代码）

- 确认本 spec schema v1
- `/feature` 模板加 §0.5（软约束：读 `.ai/design/style.md`）
- 手工维护最小 `.ai/design/` 验证工作流

### Phase 1 — MVP（约 1 周）

- `design-sync` CLI + baoyu 适配器
- MCP：`query_design`、`search_ui`、`report_design_gap`（无向量）
- `/design-system` 模板
- **不含**：bindings、register_ui_pattern、Figma、向量库

**MVP 验收：** 子 agent 开发页面前可查到 global tokens + ≥3 语义组件；缺组件会阻塞。

### Phase 2 — 检索与绑定（约 1 周）

- `design-vectors.db` + 语义 `search_ui`
- `framework-bindings.json` 约定
- `/design-page`、`design-sync --incremental`

### Phase 3 — 闭环与多源（后续）

- `register_ui_pattern`
- design audit（实现 vs 配方）
- Figma / HTML ingest 适配器
- 与 `start-init` 联动：UI 代码包 ↔ 语义组件对齐建议

---

## 11. 实现包边界（建议）

| 包/目录 | 职责 |
|---------|------|
| `design-engine/`（或 `arch-engine/src/design/`） | schema、ingest、read API |
| `mcp-server/` | 三个 MCP handler |
| `bin/design-sync.*` | CLI 入口 |
| `templates/design-system.md` | `/design-system` |
| `templates/feature.md` | §0.5 补丁 |

---

## 12. 开放问题（Phase 2+）

1. 语义组件 id 命名：沿用 baoyu PascalCase 还是项目前缀（`acme/PrimaryButton`）？
2. `refs/` 是否纳入 git（原型 HTML 体积）？
3. 多 design system 并存时 primary 冲突解析（baoyu 已有 primary 概念，ingest 需对齐）。

---

**下一步：** 用户审阅本 spec → 通过后 invoke `writing-plans` 生成 `2026-06-16-design-knowledge-layer-plan.md`。
