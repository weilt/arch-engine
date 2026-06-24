# Design Knowledge Layer 补齐设计（Phase 1–3 完整愿景）

**日期:** 2026-06-24  
**状态:** 已批准（brainstorming + 用户确认方案 B）  
**关系:** 扩展 `2026-06-16-design-knowledge-layer-design.md`；补齐至 C 档完整愿景  
**前置:** Phase 1 MVP 主体已实现；`design-bindings` + `query_design.bindings` 已提前落地（原 Phase 2 子集）

---

## 1. 背景

### 1.1 基线（2026-06-24）

| 能力 | 状态 |
|------|------|
| `design-sync` + baoyu 适配器 | ✅ |
| MCP：`query_design` / `search_ui` / `report_design_gap` | ✅ |
| `/design-system`、`/feature` §0.5 | ✅ |
| `design-bindings` CLI + `query_design(global).bindings` | ✅（Phase 2 提前） |
| `profile.preferences` | ✅（对话演进） |
| `design-vectors.db`、语义 `search_ui` | ❌ |
| `design-sync --incremental` | ❌ |
| `/design-page` | ❌ |
| `register_ui_pattern` | ❌ |
| `audit_design_changes` | ❌ |
| Figma / HTML ingest | ❌ |
| start-init ↔ design 对齐建议 | ❌ |
| 狗食验收 / reference 夹具 | ❌（仅 `demo-ds` 2 组件） |

### 1.2 目标

在**不合并** `.ai/design/` 与 `.ai/arch/` 的前提下，补齐原 spec Phase 1–3，并纳入对话演进需求：

1. `/design-system` 运行时可选：产品类型、框架（react/vue）、风格、组件库（插件层不写死）
2. 全项目统一视觉：tokens + 语义组件 + 页面配方 + 可选 bindings
3. 开发硬约束、验收、补救闭环与 arch 对称

### 1.3 非目标

- 不把设计 HTML 原型直接当生产代码复制
- 不自动合并 arch 的 UI 包与 design 语义组件（仅建议报告）
- Figma 波次 4 做最小可行适配器；复杂变量继承 Phase 4+

---

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 补齐策略 | **方案 B**：分波次交付，每波可独立验收 |
| 语义组件 id | **PascalCase**（与 baoyu 一致），暂不引入 `acme/` 前缀 |
| `refs/` 入 git | **reference 夹具入仓**；业务项目由 `.gitignore` 自选 |
| Figma | **波次 4 做最小适配器**（Variables → tokens 草稿） |
| bindings 读取 | **仅经 MCP**（`query_design` global / component），禁止子 agent 直读 `.ai/design/` |
| 向量库路径 | `.ai/design/design-vectors.db`（与 arch `vectors.db` 对称） |

---

## 3. 分波次架构

```
波次 1  Phase 1 收尾     reference-ds + 狗食测试 + README
波次 2  Phase 2 核心     design-vectors + incremental sync + /design-page
波次 3  Phase 2 深化     bindings --check + component 级 binding + MUI 模板
波次 4  Phase 3 登记     register_ui_pattern MCP
波次 5  Phase 3 验收     audit_design_changes + /verify 集成
波次 6  Phase 3 多源     HTML ingest + Figma ingest（最小）
波次 7  Phase 3 联动     start-init design-arch alignment 报告
波次 8  分发与文档       inject-platform-assets + AGENTS/README
```

---

## 4. 波次 1：Phase 1 收尾

### 4.1 `designs/apt-reference-ds/`

替换/补充 `demo-ds` 为可验收的 reference 夹具：

- **Tokens：** colors、typography、spacing、radii（完整 CSS `:root`）
- **语义组件 ≥8：** PrimaryButton、SecondaryButton、Card、PageHeader、Input、EmptyState、SkeletonList、Alert
- **页面配方 2：** `list-page`、`form-page`（含 regions、loading/empty states）
- **refs/：** 对应 HTML 原型（小体积，入仓）

### 4.2 狗食测试

`arch-engine/tests/dogfood/design-workflow.test.ts`：

1. `design-sync --source designs/apt-reference-ds`
2. `design-bindings --framework vue --library element-plus`
3. `query_design(global)` → tokens + bindings 非空
4. `query_design(page: list-page)` → 无 gaps
5. `report_design_gap` 路径可写

### 4.3 文档

README 补充 `design-bindings`、设计知识层 Phase 完成度表。

---

## 5. 波次 2：向量检索与增量同步

### 5.1 `design-vectors.db`

- 路径：`.ai/design/design-vectors.db`
- 复用 `arch-engine` `VectorStore`
- ingest 对象：组件卡片文本、页面配方、style.md 切片
- `search_ui`：关键词 score 优先；低于阈值时向量 fallback
- embedding 配置：默认 `arch.config.json` embedding；可选 `design.embedding` 覆盖

### 5.2 `design-sync --incremental`

- 比较 `designs/` 来源 mtime 与上次 sync 记录
- 仅更新变更的 token 文件、组件 JSON、页面 JSON
- 与 `--pages-only` 可组合
- 增量后触发 design 向量局部重建（变更 id 集合）

### 5.3 `/design-page` 命令

- 模板：`templates/design-page.md`
- Skill：`apt-design-page`
- 流程：单页 baoyu 定稿 → `design-sync --pages-only` → 可选 bindings check

---

## 6. 波次 3：bindings 深化

### 6.1 `query_design(component)` 附带 binding

组件查询结果增加 `binding: FrameworkBindingEntry | null`（从 `framework-bindings.json` 按 `_meta.framework` 选取）。

### 6.2 `design-bindings --check`

- 校验页面配方引用的语义 id 是否有 binding（当 `preferences.uiLibrary` 存在）
- 校验 binding 引用的语义 id 是否存在于 `components/`
- 输出 warnings JSON；非零退出可选 `--strict`

### 6.3 库模板扩展

在 `LIBRARY_TEMPLATES` 增加 **MUI**（react）；文档列出扩展方式。

---

## 7. 波次 4–5：登记与验收

### 7.1 `register_ui_pattern` MCP

```json
{
  "page": "user-settings",
  "sourcePath": "src/pages/UserSettings.vue",
  "componentsUsed": ["PrimaryButton", "Card"],
  "notes": "optional"
}
```

写入 `.ai/design/implementations/<page-slug>.json`。

### 7.2 `audit_design_changes` MCP

| 检查项 | 说明 |
|--------|------|
| `stale` | designs/ 新于 profile.syncedAt |
| `missing_bindings` | preferences 有库但组件无 binding |
| `page_gaps` | 页面配方引用未知组件 |
| `undeclared_implementations` | 有配方无 implementation 登记（可选 WARN） |
| `token_violations` | 对 `sourcePath` 启发式扫描硬编码 `#hex`、`NNpx`（可选 paths 过滤） |

### 7.3 `/verify` 集成

`templates/verify.md` 增加 **Phase 2.5 Design（含 UI 时）**：

- `query_design(global)` + 页面配方
- `audit_design_changes` 只读
- 不调用 `register_ui_pattern`（写侧属 finish-feature）

---

## 8. 波次 6–7：多源与联动

### 8.1 HTML ingest 适配器

`design-sync --adapter html --source designs/pages/foo.html`

- 解析标题、区块、`data-component` 或启发式区域 → `pages/foo.json` 草稿
- 复制 HTML 到 `refs/`

### 8.2 Figma ingest 适配器（最小）

`design-sync --adapter figma --source <fileKey>`

- 需 `FIGMA_ACCESS_TOKEN` 或 MCP figma 工具输出 JSON 落盘
- Variables → `tokens/*.json` 草稿
- Component 名 → 语义组件 id 草稿（`warnings` 需人工确认）
- 失败不阻塞 baoyu 路径

### 8.3 start-init design-arch alignment

`start-init` 完成后若存在 `.ai/design/profile.json`：

- 输出 `.ai/design/arch-alignment.json`
- 映射：arch 前端 UI 包组件名 ↔ 语义 binding.component
- **仅建议**，不写入 arch 索引

---

## 9. MCP 工具总表（完成态）

| 工具 | 波次 |
|------|------|
| `query_design` | 已有；波次 3 增强 component.binding |
| `search_ui` | 波次 2 向量 |
| `report_design_gap` | 已有 |
| `register_ui_pattern` | 波次 4 |
| `audit_design_changes` | 波次 5 |

---

## 10. 错误处理

| 场景 | 行为 |
|------|------|
| 无 embedding key | `search_ui` 降级关键词；向量索引跳过并 `warnings` |
| incremental 无 prior profile | 回退全量 sync |
| Figma token 缺失 | 非零退出 + 提示环境变量 |
| audit token_violations | 报告项，默认不阻塞 verify（可 `--strict` 未来扩展） |

---

## 11. 测试策略

| 层级 | 内容 |
|------|------|
| 单元 | ingest、incremental、vectors、bindings check、audit 规则 |
| 集成 | MCP 全工具 + 错误路径 |
| 狗食 | reference-ds 全流程 |
| CI | `arch-engine` + `mcp-server` vitest |

---

## 12. 验收标准（C 完成）

- [ ] reference-ds sync 后 ≥8 组件、2 页面、向量可搜
- [ ] `design-sync --incremental` 仅更新变更文件
- [ ] `/design-page` 模板分发到三平台
- [ ] `register_ui_pattern` + `audit_design_changes` MCP 可用
- [ ] HTML ingest 夹具测试通过
- [ ] Figma 适配器 dry-run 或 mock 测试通过
- [ ] `start-init` 产出 alignment 报告（有 design 时）
- [ ] `/verify` 含 UI 时执行 design 只读阶段

---

**下一步：** `docs/apt/plans/2026-06-24-design-knowledge-layer-completion-plan.md` → `/implement-plan`
