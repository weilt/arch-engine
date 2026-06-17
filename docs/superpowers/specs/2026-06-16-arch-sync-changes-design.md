# 开发后架构同步（sync-changes）设计规格

**日期:** 2026-06-16  
**状态:** 已批准（含命令工作流方案 C，待用户审阅 spec 文件）  
**关系:** 扩展 Arch AI 扫描 v2（`2026-06-02-arch-ai-scan-design.md`）与 APT `/finish-feature` 闭环  
**痛点:** A — 已有资产源码改了但向量库摘要过时；B — 新建可复用资产漏登记  

---

## 1. 背景与问题

### 1.1 现状

| 路径 | 行为 | 缺口 |
|------|------|------|
| `register_asset` | AI 传入 summary/whenToUse/howToUse → upsert markdown + vectors | 不读源码；**modified** 资产若 AI 未再调用则 embedding 过时（**A**） |
| `register_contract` | 更新 `.ai/db.json` + `INDEX.md` | 不进向量库 |
| `start-init --incremental` | git diff → 重扫**整模块** → summarize + upsert | 需手动执行；API 成本高；**nogit** 项目几乎无效 |
| `/finish-feature` | 要求对新资产 `register_asset` | 无变更审计；**漏登记**（**B**）；不强制刷新已改资产 |

### 1.2 目标

1. **A**：修改过的可复用资产（类/API/util 等），`search_arch` 返回的摘要与 embedding 反映**当前源码**。
2. **B**：本次开发新增的可复用资产，在 finish 闭环结束前进入 arch 索引与向量库。
3. **触发（混合 C — 同步层）**：
   - **主路径**：开发结束时的**自动闭环**（见 §3.2）；等价执行 `finish-feature` 全文（含 audit / refresh）；
   - **手动补救**：仍可单独 `/finish-feature` 或 `sync-changes`；
   - **大范围**：`start-init --incremental` / `--full`。
4. **命令工作流（方案 C）**：
   - 新增 **`/feature`**：单命令覆盖 Phase1 寻址+计划 → 用户确认 → Phase2 实现 → **Phase3 自动闭环**；
   - **`/start-feature` 保留**：文末强制「实现完成后立即自动闭环」，**禁止**等待用户再输入 `/finish-feature`；
   - **`/finish-feature` 保留**：手动补救、未走 `/feature` 的会话、仅补登记。

### 1.3 非目标（YAGNI）

- 不做 IDE 保存时实时 embed。
- 不用向量相似度推断「语义是否变更」；以**文件变更 + 资产映射**为准。
- 不把 `register_contract` 纳入向量库。
- 不替代全量/模块级 `start-init`（大规模结构变更仍走增量全模块扫描）。

---

## 2. 已确认决策

| 项 | 选择 |
|----|------|
| 方案 | **审计 + 源码重索引**（非仅强化 finish 清单、非仅薄封装 start-init） |
| 触发时机 | **混合 C**：finish-feature 必做 + `sync-changes` / `start-init --incremental` 补救 |
| 修改资产（A） | 新增 **`refresh_asset`**，从源码 AI summarize 后 upsert |
| 新资产（B） | **`audit_arch_changes`** 列出 unregistered/new → **`refresh_asset`** 或 `register_asset` |
| 删除资产 | 提供 **`remove_asset`**；finish 流程中处理 `deleted` 列表 |
| nogit | **P0** 与 audit 同批：补齐 `last-scan.json` 的 `fileHashes` 写入与对比 |
| 命令入口 | **方案 C**：新增 `/feature` + 强化 `/start-feature` 自动闭环；保留 `/finish-feature` |

---

## 3. 架构总览

### 3.0 功能开发生命周期（方案 C）

```
/feature  （推荐单入口）
  Phase 1 — 寻址 + 计划（同 start-feature §0–2）
  Phase 2 — 用户确认后写代码
  Phase 3 — 自动闭环（同 finish-feature 全文，无需用户再敲命令）

/start-feature  （兼容入口）
  Phase 1–2 同上
  Phase 3 — 硬规则：实现完成即自动闭环（禁止等待 /finish-feature）

/finish-feature  （补救入口）
  仅 Phase 3；或用户明确「只补登记」时使用
```

**重要：** Phase 3 **不是**在 Phase 1 结束后立即执行，而是在**代码实现完成**后由 Agent 自动触发。

### 3.1 同步层架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 3 自动闭环（feature / start-feature 内置，或 /finish-feature） │
│  1. audit_arch_changes                                              │
│  2. new/unregistered → refresh_asset（或 register_asset 补元数据）   │
│  3. modified → refresh_asset（必须）                                 │
│  4. deleted → remove_asset                                           │
│  5. register_contract（不变）                                        │
│  6. search_arch 抽检                                                 │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│  sync-changes CLI / MCP sync_arch_changes（可选）                    │
│  audit → 批量 refresh_asset（--dry-run 仅报告）                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│  arch-engine（新增/扩展）                                            │
│  audit/*     变更检测（git diff | fileHashes）                       │
│  refresh/*   单文件/小批 summarize + upsert（复用 pipeline 组件）    │
│  remove/*    删 md 条目 + vector by assetId                          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│  mcp-server 新增 Tools                                               │
│  audit_arch_changes | refresh_asset | remove_asset                  │
│  （可选）sync_arch_changes                                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 命令模板与 DRY

为避免三份 Prompt 漂移，抽取共享片段：

| 文件 | 职责 |
|------|------|
| `templates/_feature-closeout.md` | Phase 3 全文（原 finish-feature §0 + 契约注册 + 验证） |
| `templates/feature.md` | Phase 1–2（同 start-feature）+ **引用** closeout 作为 Phase 3 |
| `templates/start-feature.md` | Phase 1–2 + **硬规则**：完成后必须执行 closeout 全文 |
| `templates/finish-feature.md` | frontmatter + **仅** closeout 正文（手动补救） |

`agent-init` 复制 `templates/*.md` 时包含 `feature.md`；`_feature-closeout.md` 以「include 说明」或复制时拼接进 feature/finish（实现时二选一：Claude Code 不支持 transclude 则 feature/finish 内用相同正文 + 注释「与 _feature-closeout 同步」）。

### 3.3 与现有工具分工

| 工具 | 粒度 | summary 来源 | 典型场景 |
|------|------|--------------|----------|
| `start-init` | 模块/包 | 批量 discovery + summarize | 首次全量、大重构、增量整模块 |
| `sync-changes` | 文件/资产 | 变更集批量 refresh | 开发后补救、CI 可选 |
| `refresh_asset` | 单资产 | **读源码 summarize** | modified 资产、audit 后的 new |
| `register_asset` | 单资产 | **AI 手写** whenToUse 等 | AI 明确元数据、补充说明 |
| `audit_arch_changes` | — | 只读报告 | finish 第一步、dry-run |

---

## 4. 变更检测：`audit_arch_changes`

### 4.1 MCP 签名

```typescript
audit_arch_changes({
  since?: "last-scan" | "HEAD" | string,  // commit-ish；默认 last-scan.commit
  paths?: string[],                        // 可选：限制扫描范围（相对项目根）
})
```

### 4.2 返回结构

```typescript
interface AuditArchChangesResult {
  anchor: { commit: string; scannedAt?: string; mode: "git" | "fileHashes" };
  new: AuditItem[];           // 源码像可索引资产，arch 中无记录
  modified: AuditItem[];      // arch/vectors 已有，源码文件变更
  deleted: AuditItem[];       // 索引中有记录，源码文件已删
  unregistered: AuditItem[];  // discovery 命中但从未入库（B 的主信号）
}

interface AuditItem {
  sourcePath: string;       // 相对项目根，POSIX 分隔符
  assetId?: string;         // 已存在时
  suggestedKind?: AssetKind;
  suggestedName?: string;
  module?: string;
  reason?: string;
}
```

### 4.3 检测逻辑

**优先级 1 — Git 仓库**

1. 读取 `last-scan.json`；无则 `since` 视为「全量对比基准为空」，仅报告 unregistered（或提示先 `start-init`）。
2. `git diff <anchor>..HEAD --name-only`（与增量 start-init 同源）。
3. 过滤：忽略 `.ai/**`、`**/node_modules/**`、构建产物（复用 pipeline 忽略规则）。
4. 每个变更文件 → `mapFileToCandidates(file)`（复用 discovery 规则）→ 查 arch-index / vectors `source_path` → 分类 new | modified | deleted。

**优先级 2 — 非 Git（nogit）**

1. `start-init` 全量结束时写入 `last-scan.json.modules[].fileHashes`（path → sha256）。
2. audit 时遍历关注 glob，对比当前 hash vs 上次 hash。
3. 分类逻辑同 git 路径。

**P0 依赖：** 若 `fileHashes` 尚未在 pipeline 写入，须在本特性第一批实现中补齐（否则 chongqing 类项目 audit 无效）。

### 4.4 `mapFileToCandidates` 规则（与 discovery 一致）

- `*Controller.java` → kind `api`
- `*Api.java` / Feign → `rpc`
- `*Utils.java` → `util`
- `*Enum.java` → `enum`
- 前端 `components/**` → `component`
- 等（与 `arch-engine` scanners 对齐，抽取为共享函数避免漂移）

---

## 5. 源码重索引：`refresh_asset`

### 5.1 MCP 签名

```typescript
refresh_asset({
  sourcePath: string,       // 必填，相对项目根
  kind?: AssetKind,         // 可选；缺省时 audit 建议或 discovery 推断
  name?: string,
  module?: string,
})
```

### 5.2 行为

1. 校验 `sourcePath` 存在且可读。
2. 要求 `.ai/arch/arch.config.json` 存在（与 `register_asset` 一致）。
3. 对单文件构造 `RawCandidate` → 调用现有 `summarizeCandidates`（batchSize=1）→ 得到 `AssetCard`。
4. `upsertAssetCardInModuleDoc` + `patchArchIndex` + `writeArchIndex` + `writeIndexMd`。
5. `assetCardsToChunks` → `embedTexts` → `VectorStore.upsertChunks`（同 `registerAssetInArch`）。
6. 返回 `{ ok: true, id, path, action: "created" | "updated" }`。

**与 `register_asset` 区别：** refresh **禁止**用 AI 会话中过时的手写 summary 覆盖；一律从源码生成 Card 字段。

**共存：** AI 可在 refresh 后可选再调 `register_asset` 仅当需要覆盖 `whenToUse` 等叙述性字段（可选 v2；v1 不实现 overlay，refresh 即权威）。

---

## 6. 删除：`remove_asset`

### 6.1 MCP 签名

```typescript
remove_asset({
  assetId: string,
  // 或 sourcePath: string  // 二选一，解析到 assetId
})
```

### 6.2 行为

1. 从 module markdown 移除对应 Card 段落（`upsertAssetCardInModuleDoc` 的逆操作或新 `removeAssetCardFromModuleDoc`）。
2. `VectorStore.deleteByIds([assetId])`。
3. 更新 `arch-index.json`（移除节点或清空 asset 引用）。
4. 若 module 下无剩余资产，保留 overview，不删整个 module 目录。

---

## 7. CLI：`sync-changes`

### 7.1 命令

```bash
sync-changes [projectRoot]           # 默认 cwd
sync-changes --dry-run               # 仅 audit 报告（JSON 或表格）
sync-changes --paths a.java,b.ts     # 限定文件
sync-changes --since HEAD~1          # 限定 git 范围
```

实现：`arch-engine` 新入口 `src/cli-sync.ts`，由 `bin/sync-changes.sh` / `sync-changes.ps1` 调用；安装时复制到 `~/.apt/bin/`。

### 7.2 默认流程

```
audit_arch_changes()
for item in new + modified + unregistered:
  refresh_asset(item.sourcePath, ...)
for item in deleted:
  remove_asset(item.assetId)
print summary table
```

**不**更新 `last-scan.json.commit`（那是 start-init 的职责）；sync-changes 只维护 arch 内容与 vectors。

### 7.3 与 `start-init --incremental` 选型

| 场景 | 推荐 |
|------|------|
| 单次功能开发、少量文件 | `sync-changes` 或 finish-feature 内置 |
| 跨模块重构、discovery 规则变更 | `start-init --incremental` |
| 索引损坏、怀疑漂移 | `start-init --full` |

---

## 8. 命令模板更新

### 8.1 共享闭环：`templates/_feature-closeout.md`

（实现时写入该文件；以下为必须包含的步骤摘要。）

```markdown
## 架构变更同步（必须）

1. 调用 **`audit_arch_changes`** …
2. modified → **`refresh_asset`**（必须）
3. new / unregistered → **`refresh_asset`**
4. deleted → **`remove_asset`**
5. 无变更时报告「无架构资产变更」

## TS 契约注册（若有）
… register_contract …

## 验证
… search_arch 抽检 …
```

### 8.2 新命令：`templates/feature.md`

```markdown
---
description: 完整功能流：寻址、计划、实现、自动闭环（推荐）
model: sonnet
---

## Phase 1 — 寻址与计划
（与 start-feature §0–2 相同）

## Phase 2 — 实现
用户确认后写代码。禁止跳过 Phase 1。

## Phase 3 — 自动闭环（必须，无需用户再输入 /finish-feature）
实现完成且无需继续改代码时，**立即**执行下列闭环，禁止结束会话：
（嵌入 _feature-closeout.md 全文）
```

### 8.3 更新：`templates/start-feature.md`

在文末 **§2 开发计划** 之后追加：

```markdown
## 3. 实现与自动闭环（必须）

用户确认后进入实现。当实现完成且你认为可以交付时：

1. **不要**等待用户输入 `/finish-feature`。
2. **立即**执行与 `finish-feature` 相同的闭环步骤（架构 audit/refresh/remove + register_contract + 验证）。
3. 在最终报告中单独列出 **「闭环摘要」**（audit 结果、已 refresh 的 assetId、已注册契约）。

若本次仅做计划、尚未写代码，则不要执行闭环。
```

### 8.4 更新：`templates/finish-feature.md`

- 正文改为 `_feature-closeout.md` 同款（手动补救专用）。
- description 注明：「仅补闭环或补救；正常开发请用 /feature 或依赖 start-feature 自动闭环」。

---

## 9. MCP Server 变更清单

| Tool | 读写 | 实现位置 |
|------|------|----------|
| `audit_arch_changes` | 读 | `arch-engine/src/audit/changes.ts` + `mcp-server` handler |
| `refresh_asset` | 写 | `arch-engine/src/refresh/asset.ts` + handler |
| `remove_asset` | 写 | `arch-engine/src/remove/asset.ts` + handler |
| `sync_arch_changes` | 写（可选） | 封装 audit + 批量 refresh/remove；CLI 与 MCP 共用 core |

`mcp-server/src/index.ts` 注册新 tools；错误信息风格与现有三工具一致（`❌` / `✅`）。

---

## 10. 数据流与一致性

### 10.1 单一资产 ID

`refresh_asset` 与 `register_asset` 必须使用相同的 `buildAssetId(scope, module, kind, name)`，避免重复 chunk。

### 10.2 Upsert 语义

- 同 `assetId`：更新 markdown 段落 + 替换 vector 行（现有 `VectorStore.upsertChunks`）。
- 同 `sourcePath` 不同 id（重命名）：audit 报 deleted + new；由 finish 流程分别 remove + refresh。

### 10.3 Embedding 失败

与 start-init 一致：summarize 或 embed 失败 → **不**部分提交该资产；返回错误，finish 报告标红，不更新 last-scan。

---

## 11. 测试计划

| 用例 | 验证 |
|------|------|
| 修改 `*Utils.java` 方法签名 | audit → modified；refresh 后 search_arch 摘要变化 |
| 新增 `FooUtils.java` 未 register | audit → unregistered；refresh 后可 search_arch 命中 |
| 删除已索引 Java 文件 | audit → deleted；remove 后 search 无命中 |
| git 仓库增量 audit | 与 `git diff` 文件集一致 |
| nogit + fileHashes | 改文件后 audit 报 modified |
| `sync-changes --dry-run` | 无向量写入，输出与 audit 一致 |
| finish-feature 集成 | 模板步骤 0 可被 MCP 逐步执行 |

测试文件建议：

- `arch-engine/tests/audit/changes.test.ts`
- `arch-engine/tests/refresh/asset.test.ts`
- `arch-engine/tests/remove/asset.test.ts`
- `mcp-server/tests/sync-changes.test.ts`（集成）

---

## 12. 文档与发布

- `README.md`：新增「开发后同步架构」小节；说明 **`/feature`（推荐）**、`/start-feature` 自动闭环、`/finish-feature` 补救、sync-changes / start-init 选型。
- 安装脚本：部署 `sync-changes` 到 `~/.apt/bin/`。
- 不新增用户-facing markdown 文档文件（仅 README 段落）。

---

## 13. 实施分期建议

| 阶段 | 内容 | 解锁能力 |
|------|------|----------|
| **P0** | fileHashes 写入 + `audit_arch_changes` + nogit/git 双路径 | 可发现 A/B 问题 |
| **P1** | `refresh_asset` + `remove_asset` + `sync-changes` CLI | 可修复 A/B |
| **P2** | `_feature-closeout.md` + `feature.md` + 更新 start/finish 模板 + MCP 可选 `sync_arch_changes` | 自动闭环默认化 |
| **P3** | README（/feature 用法）、install、chongqing 实战验证 | 可交付 |

---

## 14. 自审清单（2026-06-16）

- [x] 无 TBD / 占位符段落
- [x] 与 v2 设计 `register_asset`、`last-scan`、`incremental` 无矛盾；明确分工
- [x] 范围聚焦单特性（开发后同步），未膨胀为全仓库 watcher
- [x] nogit 路径已写清 P0 依赖 fileHashes
- [x] `refresh` vs `register` 职责边界明确
- [x] Phase 3 自动闭环与 Phase 1 时机分离；方案 C 三命令关系明确

---

## 15. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-06-16 | 初稿：brainstorming 批准（痛点 A+B，触发混合 C） |
| 2026-06-16 | 增补：命令工作流方案 C（/feature + start 自动闭环 + finish 补救） |
