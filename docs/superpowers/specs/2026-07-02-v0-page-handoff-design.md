# v0 页面 Handoff：视觉伴侣 → manifest + logic → design-sync

**日期:** 2026-07-02  
**状态:** 待用户审阅  
**关系:** 扩展 Design Knowledge Layer（`2026-06-16`、`2026-06-24`）；与 APT 2.0.5 `/feature` §0.5、`/design-page`、`query_design` 衔接  
**方案:** PM 标准交付包 + Codex 视觉伴侣生成双文件 + `design-sync --adapter v0`

---

## 1. 背景与问题

### 1.1 现状

| 层级 | 能力 | 缺口 |
|------|------|------|
| **v0** | PM 用 v0 出 React/shadcn 页面 | 交付物多为链接、对话或零散 TSX，**无统一「功能语义」** |
| **APT design-sync** | `baoyu` / `html` / `figma` 适配器 | **无 `v0` 适配器**；`html` 仅从文件名/title 推断 |
| **`query_design(page:)`** | 读 `.ai/design/pages/*.json` | `DesignPageRecipe` 无 `pageType` / `feature` / 逻辑文档 |
| **`/design-page`** | 单页定稿 + `--pages-only` | 未绑定 manifest/logic 模板与 v0 目录规范 |

### 1.2 目标

1. **每个 v0 页面**有稳定目录：`page.manifest.json`（是什么页）+ `page.logic.md`（怎么操作）。
2. **Codex 视觉伴侣**可按页看图生成上述双文件草稿，PM 审后定稿。
3. **`design-sync --adapter v0`** 将双文件 + 可选 `page.tsx` / `preview.html` 写入 `.ai/design/`。
4. 开发子 Agent **`query_design(page:)`** 返回功能语义 + 逻辑摘要 + 源码引用；缺失则 **`report_design_gap`**。

### 1.3 非目标

- 不调用 v0.dev API 自动拉取聊天/链接内容
- 不把 v0 TSX **盲拷**为生产代码（仍：语义配方 + refPath + bindings 重建/改造）
- 不在本 spec 实现视觉伴侣本身（用 Codex 既有能力 + prompt 模板）
- 不合并 `.ai/design/` 与 `.ai/arch/`

---

## 2. 已确认决策（brainstorming）

| 项 | 选择 |
|----|------|
| PM 交付入口 | 可从 v0 **链接+对话**起步，但**可开发门槛**为目录内双文件 + 代码/ref |
| 功能语义 SSOT | **`page.manifest.json`** |
| 操作明细 SSOT | **`page.logic.md`** |
| 双文件生成 | **Codex 视觉伴侣**按页生成草稿 → **PM 必审** |
| 知识库写入 | **`design-sync --adapter v0`** |
| 与 2.0.5 | 增量能力，不修改 autonomous-loop / ontology 核心 |

---

## 3. PM 标准交付包

### 3.1 目录结构

```text
designs/v0/<page-id>/
  page.manifest.json    # 必填：页面身份与功能归类
  page.logic.md         # 必填：操作明细与业务逻辑
  page.tsx              # 推荐：v0 导出 React 源码（实现锚点）
  preview.html          # 可选：静态预览（视觉伴侣输入）
  handoff.meta.json     # 可选：v0Url、生成时间、伴侣会话 id
```

- **`<page-id>`** = manifest 内 `id`（kebab-case，与 `query_design(page:)` 一致）。
- 整包**提交 Git**（与 `designs/apt-reference-ds/` 夹具策略一致）。

### 3.2 `page.manifest.json` Schema

```json
{
  "id": "user-list",
  "pageType": "list",
  "feature": "user-management",
  "title": "用户列表",
  "route": "/admin/users",
  "description": "管理员查看、筛选、批量操作用户",
  "v0Url": "https://v0.dev/chat/...",
  "status": "draft | approved",
  "reviewedBy": "pm-name",
  "reviewedAt": "ISO8601"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | kebab-case，合法 `DesignId` |
| `pageType` | ✅ | 见 §3.3 |
| `feature` | ✅ | 产品模块/业务能力 slug |
| `title` | ✅ | 中文或产品名 |
| `route` | ✅ | 计划路由；未知写 `TBD` + sync warning |
| `description` | ✅ | 一句话功能 |
| `v0Url` | 推荐 | 溯源 |
| `status` | 推荐 | `approved` 前禁止下游 `/feature` UI 实现（见 §6） |
| `reviewedBy` / `reviewedAt` | `approved` 时必填 | PM 审阅记录 |

### 3.3 `pageType` 枚举（首期）

`list | form | detail | dashboard | auth | settings | wizard | custom`

与 reference 夹具 `list-page`、`form-page` 配方**软对齐**（`search_ui` 可关联），不要求 id 同名。

### 3.4 `page.logic.md` 结构（模板）

```markdown
# {title}

## 角色与权限
- …

## 主流程
1. …

## 操作明细
| 操作 | 触发 | 结果 | 异常 |
|------|------|------|------|
| … | … | … | … |

## 页面状态
- 加载：…
- 空：…
- 错误：…

## 依赖（名称即可，实现查契约/arch）
- ContractOrApi.name
```

逻辑文档**不**登记契约；开发阶段对表中名称执行 `query_contract` / `search_arch`。

---

## 4. Codex 视觉伴侣工作流

### 4.1 适用条件

| 输入 | 伴侣能否高质量生成 |
|------|-------------------|
| `preview.html` 或本地可打开预览 | ✅ 推荐 |
| v0 分享页 / 截图 | ✅ |
| 仅链接（页面打不开） | ⚠️ 仅低置信度草稿，标 `status: draft` |
| 仅口头描述 | ❌ 改走 `/design-page` 对话，不冒充视觉分析 |

### 4.2 每页一轮（不批量糊 manifest）

1. PM 提供：`designs/v0/<page-id>/` 路径 + 预览入口。  
2. Codex 视觉伴侣：**打开页面**，观察布局、控件、状态。  
3. 生成/覆盖 `page.manifest.json`、`page.logic.md`（`status: draft`）。  
4. PM 审阅：改 route、权限、接口名 → `status: approved`，填 `reviewedBy` / `reviewedAt`。  
5. PM/开发从 v0 **导出 `page.tsx`**（及可选 `preview.html`）放入同目录。  
6. 运行 `design-sync --adapter v0 --source designs/v0/<page-id>`。

### 4.3 Prompt 模板（交付物）

仓库新增 **`templates/v0-visual-handoff-prompt.md`**（实现阶段），要点：

- 只写 `designs/v0/<page-id>/` 下两文件，不写 `src/`  
- 不确定字段写 `TBD` 并在 logic 备注「待 PM 确认」  
- 操作明细表至少覆盖：主按钮、列表操作、表单提交、返回/跳转  
- 从 UI 推断 `pageType`，与 §3.3 枚举对齐  

可选：扩展 **`/design-page`** 引用该模板，或新增 **`/design-v0-handoff`** 命令（实现阶段二选一，推荐扩 `/design-page` §「v0 分支」以减少命令数）。

---

## 5. `design-sync --adapter v0`

### 5.1 输入

```bash
design-sync --adapter v0 --source designs/v0/user-list
# 或批量：--source designs/v0  （扫描一级子目录，每个含 manifest 的目录为一页）
```

### 5.2 行为

1. 读 `page.manifest.json`；缺文件 → **exit 1**，明确错误。  
2. 读 `page.logic.md`；缺文件 → **exit 1**。  
3. `status !== approved` → **warning**，仍写入 `.ai/design/`（便于预览），但 `query_design` 返回 `gaps` 含 `manifest-not-approved`。  
4. 解析 `page.tsx`：启发式抽检 `pageType`（Table→list、form→form 等），与 manifest 不一致 → **warning** 列表。  
5. 若有 `preview.html`：复制到 `.ai/design/refs/<page-id>.html`，加入 `refPaths`。  
6. 写出扩展后的 **`DesignPageRecipe`**（§5.3）。  
7. 增量：manifest/logic/tsx mtime 变更 → 仅重建该 page 向量切片。

### 5.3 `DesignPageRecipe` 扩展

```typescript
interface DesignPageRecipe {
  id: string;
  title: string;
  pageType?: string;       // 来自 manifest
  feature?: string;
  route?: string;
  description?: string;
  regions: { id: string; components: string[] }[];
  states?: Record<string, string>;
  refPaths?: string[];     // tsx, html refs
  logicPath?: string;      // 相对 .ai/design，如 "logic/user-list.md"
  manifestPath?: string;   // 溯源 designs/v0/...
  v0Url?: string;
  approval?: { status: string; reviewedBy?: string; reviewedAt?: string };
}
```

`page.logic.md` 全文复制到 **`.ai/design/logic/<page-id>.md`**（MCP 可读，不 gitignore）。

### 5.4 `query_design(page:)` 扩展

返回 `QueryDesignPageResult` 增加：

- `page` 扩展字段（上表）  
- `logicMarkdown?: string`（logic 文件全文或 ≤8k 字符截断 + 提示路径）  
- `gaps: string[]`：如无 logic、manifest 未批准、无 tsx ref  

---

## 6. 与开发流程衔接

### 6.1 `/feature` §0.5（含 UI）

1. `query_design(scope: global)`  
2. `query_design(page: <slug>)` — **必须**；读 logic + manifest 字段  
3. 若 `gaps` 含 `manifest-not-approved` 或缺页 → **`report_design_gap`**，停止 UI  
4. 对 `page.logic.md` 中列出的依赖名逐个契约/arch 寻址  

### 6.2 `/verify`（含 UI）

抽检：plan 声明的 page slug 在 `query_design` 中 `approval.status === approved`，且 logic 中列出的关键操作在实现或测试中有对应（人工/Agent 判断，首期不做自动 diff）。

### 6.3 `/apt-goal` 自主交付

plan Task 可显式包含：「v0 handoff → design-sync v0 → 实现」；未 `approved` 的页不得进入 implement UI Task。

---

## 7. 错误处理

| 场景 | 行为 |
|------|------|
| 无 manifest / logic | `design-sync` exit 1 |
| manifest `id` 与目录名不一致 | warning，以 manifest.id 为准 |
| 无 `page.tsx` | sync 成功但 `gaps` 含 `no-implementation-ref`；UI 实现仍 gap |
| 伴侣生成 route=TBD | 允许 sync；`report_design_gap` 直到 PM 批准并改 route |
| TSX 与 manifest pageType 冲突 | warning only |

---

## 8. 测试策略

| 层级 | 内容 |
|------|------|
| 单测 | manifest 解析、logic 复制、recipe 字段映射、gaps 判定 |
| 夹具 | `designs/v0-fixture/user-list/` 最小四文件集 |
| 狗食 | sync → `query_design(page:)` → `report_design_gap` 路径 |
| 不测 | Codex 视觉伴侣画质、v0 导出质量 |

---

## 9. 实现顺序（供 plan）

1. Schema 类型 + `ingest/v0.ts` + 单测  
2. `design-sync` 注册 `--adapter v0`  
3. `query_design` / `search_ui` 扩展 + gaps  
4. `templates/v0-visual-handoff-prompt.md` + `/design-page` v0 分支  
5. README + `designs/v0-fixture/` + 狗食测试  

---

## 10. 与现有文档关系

| 文档 | 关系 |
|------|------|
| `2026-06-16-design-knowledge-layer-design.md` | 本 spec 为 v0 适配器扩展 |
| `2026-06-24-design-knowledge-layer-completion-design.md` | HTML ingest 波次 6 并列；v0 为新增适配器 |
| `2026-06-25-apt-2.0-autonomous-loop-design.md` | 正交；apt-goal 可引用 v0 handoff Task |

---

## 11. 成功标准

1. PM 按 §3 交付后，`design-sync --adapter v0` 产出可查询 page 配方 + logic 副本。  
2. Codex 视觉伴侣按 §4 模板可生成可审草稿（人工验收 1 个 fixture 页）。  
3. `/feature` 对未批准页 `report_design_gap` 阻塞。  
4. `query_design(page:)` 能回答「这是什么功能、有哪些操作、源码在哪」。
