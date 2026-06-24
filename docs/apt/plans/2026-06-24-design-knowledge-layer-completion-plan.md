# Design Knowledge Layer 补齐 Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-06-24-design-knowledge-layer-completion-design.md`
> **Command:** `/plan-from-spec`（由 brainstorming 直接产出）
> **Status:** approved

**Goal:** 补齐设计知识层 Phase 1–3 完整愿景（方案 B 分波次）；含 reference 夹具、向量检索、增量 sync、design-page、bindings 深化、register/audit MCP、HTML/Figma ingest、start-init 联动、verify 集成。

**Architecture:** 主要在 `arch-engine/src/design/` 与 `mcp-server/` 扩展；新增 CLI/bin；模板经 `inject-platform-assets` 分发。复用 `VectorStore` 与 `audit_arch_changes` 模式。

---

## Part 1 — 技术方案（APT 寻址）

### 1.1 范围与约束

**范围内：**

- `arch-engine/src/design/`：vectors、incremental、html/figma ingest、bindings check、implementations、audit、alignment
- `mcp-server/`：`register_ui_pattern`、`audit_design_changes`；增强 `query_design` / `search_ui`
- CLI：`design-bindings --check`；`design-sync --incremental --adapter`
- 夹具：`designs/apt-reference-ds/`
- 模板：`design-page.md`、`verify.md` design 阶段、`design-system` /README 更新
- `scripts/inject-platform-assets.cjs`：新增 `design-page.md`

**非目标：**

- 不合并 `.ai/design/` 与 `.ai/arch/`
- Figma 不做全量 Design System 双向同步
- 不实现 `register_ui_pattern` 的向量索引（JSON 文件足够）

### 1.2 设计寻址

含 UI 的 Task 在 brief 中注明：实现后由 `/verify` design 阶段抽检；开发时子 agent 仍 `query_design` 先行。

### 1.3 依赖寻址表

| 依赖 | 来源 | 引用 | 摘要 |
|------|------|------|------|
| `VectorStore` | arch-engine | `arch-engine/src/vector/sqlite-store.ts` | design-vectors.db |
| `runDesignSync` | arch-engine | `arch-engine/src/design/sync.ts` | 扩展 incremental/adapter |
| `queryDesign` / `searchUi` | arch-engine | `arch-engine/src/design/query.ts` | 增强 bindings/vectors |
| `generateFrameworkBindings` | arch-engine | `arch-engine/src/design/bindings.ts` | --check、MUI |
| `audit_arch_changes` 模式 | arch-engine | `arch-engine/src/audit/changes.ts` | audit_design 参考 |
| `handleQueryDesign` | mcp-server | `mcp-server/src/design-query.ts` | MCP 桥接 |
| `inject-platform-assets` | 脚本 | `scripts/inject-platform-assets.cjs` | 模板分发 |
| `verify` 模板 | 模板 | `templates/verify.md` | 增加 design 阶段 |
| 原 design spec | 文档 | `docs/superpowers/specs/2026-06-16-design-knowledge-layer-design.md` | schema 基准 |

### 1.4 拟改动模块（汇总）

| 模块 | 主要新增/改 |
|------|-------------|
| `arch-engine/src/design/vectors.ts` | 新：索引与 search fallback |
| `arch-engine/src/design/incremental.ts` | 新：增量 sync |
| `arch-engine/src/design/ingest/html.ts` | 新：HTML 适配器 |
| `arch-engine/src/design/ingest/figma.ts` | 新：Figma 最小适配器 |
| `arch-engine/src/design/audit.ts` | 新：audit_design_changes |
| `arch-engine/src/design/implementations.ts` | 新：register_ui_pattern 存储 |
| `arch-engine/src/design/alignment.ts` | 新：start-init 报告 |
| `mcp-server/src/design-*.ts` | 新/改 handlers |
| `designs/apt-reference-ds/` | 新夹具 |
| `templates/design-page.md` | 新命令 |

### 1.5 风险

| 风险 | 缓解 |
|------|------|
| 长任务 compaction 丢状态 | `.apt/orchestration/progress.md` + task brief |
| Figma API 不可用 CI | mock JSON 夹具 + dry-run |
| embedding key 缺失 | 向量降级关键词，测试 mock embedding |

---

## Part 2 — 可执行任务清单

> 由 `/implement-plan` **严格串行**执行；每 Task 通过 Review Gate 后 `git commit`。

### Task 1: reference 夹具 + 狗食测试 + README

- [ ] 创建 `designs/apt-reference-ds/`（≥8 组件、2 页面、tokens、refs）
- [ ] 添加 `arch-engine/tests/dogfood/design-workflow.test.ts`
- [ ] README 补充 `design-bindings` 与设计层完成度
  - **Files:** `designs/apt-reference-ds/**`, `arch-engine/tests/dogfood/design-workflow.test.ts`, `README.md`
  - **Verify:** `cd arch-engine && npm test -- tests/dogfood/design-workflow.test.ts`
  - **MCP:** N/A

### Task 2: design-vectors.db + 语义 search_ui

- [ ] 新增 `arch-engine/src/design/vectors.ts`；路径 `.ai/design/design-vectors.db`
- [ ] `runDesignSync` 完成后重建/局部更新向量索引
- [ ] `searchUi` 关键词 + 向量 fallback
- [ ] 单元/集成测试
  - **Files:** `arch-engine/src/design/vectors.ts`, `query.ts`, `sync.ts`, `paths.ts`, `types.ts`, tests
  - **Verify:** `cd arch-engine && npm test -- tests/design/`
  - **MCP:** N/A

### Task 3: design-sync --incremental

- [ ] 新增 `arch-engine/src/design/incremental.ts`
- [ ] CLI `design-sync` 支持 `--incremental`
- [ ] 与向量局部重建联动
  - **Files:** `incremental.ts`, `sync.ts`, `cli-design-sync.ts`, tests
  - **Verify:** `cd arch-engine && npm test -- tests/design/`
  - **MCP:** N/A

### Task 4: /design-page 命令模板与分发

- [ ] 新增 `templates/design-page.md`、`.agents/skills/apt-design-page/SKILL.md`
- [ ] 更新 `inject-platform-assets.cjs`、AGENTS 片段、README
  - **Files:** `templates/design-page.md`, `scripts/inject-platform-assets.cjs`, platform outputs
  - **Verify:** `node scripts/inject-platform-assets.test.js`
  - **MCP:** N/A

### Task 5: bindings 深化（component.binding + --check + MUI）

- [ ] `query_design(component)` 返回 `binding`
- [ ] `design-bindings --check` / `--strict`
- [ ] `LIBRARY_TEMPLATES` 增加 `mui`
  - **Files:** `bindings.ts`, `query.ts`, `cli-design-bindings.ts`, `mcp-server`, tests
  - **Verify:** `cd arch-engine && npm test`；`cd mcp-server && npm test -- design-query`
  - **MCP:** `query_design`

### Task 6: register_ui_pattern MCP

- [ ] `implementations.ts` + MCP handler（第 14 个工具）
  - **Files:** `implementations.ts`, `mcp-server/src/design-register.ts`, tests
  - **Verify:** `cd mcp-server && npm test`
  - **MCP:** `register_ui_pattern`

### Task 7: audit_design_changes MCP

- [ ] `audit.ts` + MCP handler
  - **Files:** `audit.ts`, `mcp-server/src/design-audit.ts`, tests
  - **Verify:** `cd mcp-server && npm test`
  - **MCP:** `audit_design_changes`

### Task 8: HTML ingest 适配器

- [ ] `ingest/html.ts` + `design-sync --adapter html`
  - **Files:** `ingest/html.ts`, fixtures, tests
  - **Verify:** `cd arch-engine && npm test`
  - **MCP:** N/A

### Task 9: Figma ingest 适配器（最小 + mock）

- [ ] `ingest/figma.ts` + 夹具 JSON
  - **Files:** `ingest/figma.ts`, fixtures, tests
  - **Verify:** `cd arch-engine && npm test`
  - **MCP:** N/A

### Task 10: start-init design-arch alignment

- [ ] `alignment.ts` + `pipeline.ts` 挂钩
  - **Files:** `alignment.ts`, `pipeline.ts`, tests
  - **Verify:** `cd arch-engine && npm test`
  - **MCP:** N/A

### Task 11: /verify design 阶段 + 文档收尾

- [ ] `templates/verify.md` design 阶段；README 14 工具；inject 全量
  - **Files:** `templates/verify.md`, `README.md`, inject script
  - **Verify:** arch-engine + mcp-server + inject tests
  - **MCP:** `audit_design_changes` 只读

---

## Part 3 — 实现后验收

```bash
/verify docs/apt/plans/2026-06-24-design-knowledge-layer-completion-plan.md
```
