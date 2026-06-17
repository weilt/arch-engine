# Arch Sync-Changes（开发后架构同步）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: **superpowers:executing-plans**（主会话 Inline 串行执行）。子 Agent 仅作**可选加速器**，且须遵守下文「MCP 与技能分层」——**禁止**让子 Agent 承担跨域 MCP 调用。本计划 **严格串行**：一次只完成一个 Block，验收通过后再进入下一块。这是 APT 开发 loop 的基础节奏。

**Goal:** 实现开发后架构同步闭环：发现源码变更（audit）→ 从源码重索引（refresh）→ 删除失效资产（remove）→ CLI/MCP 暴露 → `/feature` 与自动闭环模板，解决向量摘要过时（A）与漏登记（B）。

**Architecture:** 在 `arch-engine` 新增 `fileHashes` 写入、`audit/*`、`refresh/*`、`remove/*`、`cli-sync.ts`；`mcp-server` 注册三工具（可选第四 `sync_arch_changes`）；`templates` 抽取 `_feature-closeout.md` 并新增 `feature.md`；`bin/sync-changes.*` 部署到 `~/.apt/bin/`。

**Tech Stack:** Node.js 18+, TypeScript, Vitest, better-sqlite3, OpenAI 兼容 REST（summarize + embedding）

**Spec:** `docs/superpowers/specs/2026-06-16-arch-sync-changes-design.md`

---

## 主 Agent 编排规则（Loop 基础 — 必读）

### 串行 Block 一览

| Block | 名称 | 解锁能力 | 验收门槛 |
|-------|------|----------|----------|
| **B0** | APT 项目根 + 模板 frontmatter | MCP 在多 IDE 下指向正确项目 | `write-project-mcp-json` 测试通过；`agent-init` 写入 `APT_PROJECT_ROOT` |
| **B1** | fileHashes + `audit_arch_changes` | 能发现 modified / unregistered / deleted | `arch-engine` audit 测试全绿；MCP `audit_arch_changes` 可调用 |
| **B2** | `refresh_asset` | 改源码后 search 摘要更新 | refresh 单测 + MCP 集成 |
| **B3** | `remove_asset` + `sync-changes` CLI | 命令行批量同步 | CLI `--dry-run` + 写路径测试 |
| **B4** | 命令模板 + `sync_arch_changes`（可选） | `/feature` 自动闭环 Prompt 就绪 | 模板文件齐全；`agent-init` 不复制 `_*.md` |
| **B5** | README + install + chongqing 狗食 | 可交付 | `install.ps1` 后 `sync-changes --dry-run` 在 chongqing 有输出 |

### 执行顺序（禁止并行实现 Block）

```
主 Agent
  → 完成 B0 → 验收 → commit（用户要求时）
  → 完成 B1 → cd arch-engine && npm test && cd ../mcp-server && npm test
  → 完成 B2 → 同上
  → 完成 B3 → 同上 + bin/sync-changes 手动试跑
  → 完成 B4 → agent-init 到临时目录检查 commands
  → 完成 B5 → chongqing 实战记录
```

**禁止：** 同时派两个子 Agent 改 `pipeline.ts`、`register-asset.ts`、模板三处。

---

## 执行模式：Inline 主会话 + 受限子 Agent（已选）

**主 Agent（本会话）职责：**
- 按 Block B0→B5 **串行**推进；维护 TodoWrite / checkpoint
- **所有 MCP 验收**（`audit_arch_changes`、`refresh_asset` 等）由主 Agent 或 **CLI 等价物**完成
- Block Gate 未通过 **不得**进入下一块
- 跨域工作（前端 UI + 后端 Java + 部署）由主 Agent **编排**，不交给单一子 Agent

**子 Agent 仅用于：**
- 单 Block 内「机械实现」：明确 1–3 个文件、完整 spec、**验收只靠 `npm test` / `node --test`**
- **禁止**子 Agent 调用：Vercel、Figma、browser、APT MCP（Cursor Task 子进程通常**没有**父会话的 MCP 列表）
- 子 Agent 完成后：主 Agent 做 spec 对照 + 跑 Gate 命令；**主 Agent** 再 commit（用户要求时）

```
主 Agent（Inline，持有 MCP + 全域技能）
  │
  ├─ B0–B3 实现 ──可选──► 子 Agent「只写 arch-engine/mcp-server 代码 + vitest」
  │                        （禁止调 MCP；禁止改 templates）
  │
  ├─ B4 模板 ───────────► 建议主 Agent 自写（Prompt 漂移敏感）
  │
  └─ B5 狗食 ───────────► 主 Agent 调 CLI；若验前端页面再按需开 browse / Vercel 技能
```

---

## MCP 与技能分层（Loop 基础）

### 三层 MCP（不要混在一个子 Agent 里）

| 层级 | 服务器 / 工具 | 用途 | 本计划 Block | 谁调用 |
|------|----------------|------|--------------|--------|
| **L1 架构** | `agent-protocol-mcp`：`audit_arch_changes`、`refresh_asset`、`remove_asset`、`search_arch`、`register_*` | 开发闭环、向量同步 | B1–B5 验收；B4 模板描述 | **仅主 Agent**（或业务项目里跑 `/feature` 的会话） |
| **L2 领域** | Vercel MCP、Figma MCP、Unity MCP 等 | 部署、设计稿、引擎 | **本计划不涉及**；B5 若只验 Java arch **不需要** | 主 Agent 按任务类型切换；**独立子 Agent 且单域** |
| **L3 验证** | `cursor-ide-browser` / gstack browse | 页面狗食、截图 | B5 可选（chongqing 有前端页时） | 主 Agent 或 `explore` 只读子 Agent |

**铁律：**
1. **实现子 Agent** → 只用 Shell + Read/Write + 测试；**不调任何 MCP**
2. **闭环子 Agent**（未来业务 `/feature` Phase 3）→ 只调 **L1**；不调 Vercel/Figma
3. **前端实现子 Agent** → 可读 Figma（L2），但 **不负责** `refresh_asset`；完成后交主 Agent 做 L1 闭环
4. **后端实现子 Agent** → Java/TS 业务代码；arch 同步仍由主 Agent 统一 L1

### 技能（Skills）路由

| 场景 | 推荐技能 | 本计划 |
|------|----------|--------|
| 执行本 plan | `executing-plans` | B0–B5 全程 |
| 机械子任务 | 无额外技能；子 Agent prompt 内嵌 Block 全文 | B1–B3 可选 |
| 模板 / 文档措辞 | `doc-coauthoring`（可选） | B4、B5 README |
| Next.js / Vercel 部署 | `nextjs`、`vercel-cli`、`deployments-cicd` | 仅 chongqing **前端**验部署时 |
| Figma 对齐 | `figma-use`、`figma-generate-design` | 仅 **UI 功能**开发时；**不是** B1–B3 |
| 页面 QA | `gstack-qa` / browse | B5 可选 |
| 调试失败测试 | `gstack-investigate` | 任一 Block Gate 失败时 |

**前后端分工（全栈 `/feature` 前瞻，写入 loop 约定）：**

| Phase | 后端会话重点 | 前端会话重点 | 共享闭环 |
|-------|--------------|--------------|----------|
| Phase 1 寻址 | `search_arch` 查 Java util/api | `query_contract` + `search_arch` 查 component | 同一 L1 |
| Phase 2 实现 | Java 模块；子 Agent `generalPurpose` | React/Next；子 Agent + **Figma/Vercel 技能** | 各域不交叉改库 |
| Phase 3 闭环 | `audit` → `refresh` Java 路径 | `audit` → `refresh` TS/组件路径 | **主 Agent 一次 audit 覆盖全仓** |

---

## Block 级：实现 / MCP / 技能 / 子 Agent

| Block | 主 Agent | 可派子 Agent？ | 子 Agent 允许 | 子 Agent 禁止 | Gate 验证方式 |
|-------|----------|----------------|---------------|---------------|---------------|
| **B0** | 自执行或核对已有改动 | 可选 | `write-project-mcp-json` 测试 | MCP、改 arch-engine | `node --test scripts/...` |
| **B1** | 编排 + MCP 冒烟 | 推荐 | `arch-engine/**`、`mcp-server/**` 实现 + vitest | templates、调 MCP | `npm test` + 主 Agent 调 `audit_arch_changes` |
| **B2** | 同上 | 推荐 | `refresh/**` + handler | 其它 Block 文件 | vitest + 主 Agent `refresh_asset` |
| **B3** | 同上 | 推荐 | `remove/**`、`sync/**`、`cli-sync` | B4 模板 | vitest + `sync-changes --dry-run` |
| **B4** | **建议自执行** | 不推荐 | — | — | 目视 diff + `agent-init` 复制结果 |
| **B5** | 自执行 + 狗食 | 仅 `explore` 读 chongqing | README、install | 改核心逻辑 | `install.ps1` + CLI；可选 browse |

---

## 子 Agent 派发模板（复制即用）

派子 Agent 时 **必须**粘贴以下约束（替换 `{BLOCK}`、`{FILES}`）：

```markdown
## 任务
实现 Arch Sync-Changes 计划 **{BLOCK}**，仅修改：{FILES}

## 仓库
F:/software/claude_plugin

## 验收（你必须自己跑）
cd arch-engine && npm test
cd ../mcp-server && npm test

## 禁止
- 不要调用任何 MCP 工具（你没有 agent-protocol / Vercel / Figma）
- 不要修改 templates/ 或 .claude/commands/
- 不要 commit（主 Agent 负责）
- 不要实现其它 Block 的范围

## 成功标准
测试全绿；返回：改了哪些文件、handoff 3 行、未决问题
```

**主 Agent 在子 Agent 返回后必须：**
1. 亲自跑 Block Gate（含 MCP 或 CLI）
2. 对照 spec 节号做 30 秒 spec review
3. 通过后再进下一 Block

---

## CLI 作为 MCP 的降级路径（子 Agent 友好）

子 Agent 无法调 MCP 时，主 Agent 用 CLI 做**等价验收**：

| MCP | CLI / 测试等价 |
|-----|----------------|
| `audit_arch_changes` | `sync-changes --dry-run`（B3 后）或 `arch-engine` 单测调用 `auditArchChanges()` |
| `refresh_asset` | `arch-engine` 单测 / 临时 `node -e` 引 `refreshAssetInArch` |
| `remove_asset` | 单测 `removeAssetFromArch` |
| `search_arch` | `mcp-server` 集成测试 `arch-query.test.ts` |

**Loop 约定：** 插件开发阶段以 **vitest + CLI** 为子 Agent 验收真相来源；MCP 由主 Agent 在 install 后抽测一次即可。

---

## File Map

| 文件 | 职责 | Block |
|------|------|-------|
| `scripts/write-project-mcp-json.js` | `APT_PROJECT_ROOT` + `.mcp.json` + `.cursor/mcp.json` | B0 |
| `scripts/write-project-mcp-json.test.js` | 脚本单测 | B0 |
| `arch-engine/src/incremental/file-hashes.ts` | 计算模块/包内源文件 sha256 | B1 |
| `arch-engine/src/discovery/map-file.ts` | 单文件 → `RawCandidate`（复用 Java/TS 分类） | B1 |
| `arch-engine/src/audit/changes.ts` | `auditArchChanges()` 核心 | B1 |
| `arch-engine/src/audit/ignore.ts` | 忽略 `.ai/**`、`node_modules` 等 | B1 |
| `arch-engine/tests/audit/changes.test.ts` | audit 单测 | B1 |
| `arch-engine/tests/incremental/file-hashes.test.ts` | hash 单测 | B1 |
| `arch-engine/src/pipeline.ts` | `buildLastScanState` 写入真实 `fileHashes` | B1 |
| `mcp-server/src/audit-changes.ts` | MCP handler 薄封装 | B1 |
| `arch-engine/src/refresh/asset.ts` | `refreshAssetInArch()` | B2 |
| `arch-engine/tests/refresh/asset.test.ts` | refresh 单测 | B2 |
| `mcp-server/src/refresh-asset.ts` | MCP handler | B2 |
| `arch-engine/src/remove/asset.ts` | `removeAssetFromArch()` | B3 |
| `arch-engine/src/writer/asset-md.ts` | `removeAssetSectionFromMarkdown()` | B3 |
| `arch-engine/src/sync/run.ts` | `runSyncChanges()` audit→refresh→remove | B3 |
| `arch-engine/src/cli-sync.ts` | CLI 入口 | B3 |
| `arch-engine/tests/remove/asset.test.ts` | remove 单测 | B3 |
| `arch-engine/tests/sync/run.test.ts` | sync 编排单测 | B3 |
| `bin/sync-changes.ps1` / `.sh` / `.cmd` | 调用 `cli-sync.js` | B3 |
| `templates/_feature-closeout.md` | Phase 3 共享正文（非 slash 命令） | B4 |
| `templates/feature.md` | `/feature` 全流 | B4 |
| `templates/start-feature.md` | 追加 §3 自动闭环 | B4 |
| `templates/finish-feature.md` | 改为 closeout + audit/refresh | B4 |
| `bin/agent-init.ps1` / `.sh` | 排除 `_*.md` 复制 | B4 |
| `mcp-server/src/sync-changes.ts` | 可选 `sync_arch_changes` | B4 |
| `README.md` | 开发后同步 + `/feature` 说明 | B5 |

---

# Block B0: APT 项目根 + 模板 frontmatter

**Handoff 给 B1：** `agent-init` 已在目标项目写入 `APT_PROJECT_ROOT`；`start-feature` / `finish-feature` 有 frontmatter。B1 起所有 MCP 集成测试应设 `APT_PROJECT_ROOT`。

> 注：B0 代码可能已在工作区未提交；先 `git status`，有则验收后 commit，无则按下列步骤实现。

## Task B0.1: 验证 write-project-mcp-json

**Files:**
- Verify: `scripts/write-project-mcp-json.js`
- Verify: `scripts/write-project-mcp-json.test.js`

- [ ] **Step 1: 运行脚本测试**

Run: `cd F:/software/claude_plugin && node --test scripts/write-project-mcp-json.test.js`  
Expected: 全部 PASS

- [ ] **Step 2: 手动冒烟**

Run: `node scripts/write-project-mcp-json.js %TEMP%/apt-smoke "C:/fake/entry.js"`（PowerShell 用 `$env:TEMP`）  
Expected: 生成 `.mcp.json` 与 `.cursor/mcp.json`，且 `env.APT_PROJECT_ROOT` 为绝对路径

- [ ] **Step 3: Commit（仅当用户要求）**

```bash
git add scripts/write-project-mcp-json.js scripts/write-project-mcp-json.test.js README.md scripts/merge-mcp-config.ps1
git commit -m "fix: set APT_PROJECT_ROOT in project MCP configs for Claude and Cursor"
```

**Block B0 Gate:** `node --test scripts/write-project-mcp-json.test.js` 通过。

---

# Block B1: fileHashes + audit_arch_changes

**Handoff 给 B2：** `auditArchChanges(projectRoot)` 返回 `new|modified|deleted|unregistered`；nogit 靠 `fileHashes`；MCP `audit_arch_changes` 返回 JSON。

## Task B1.1: file-hashes 工具

**Files:**
- Create: `arch-engine/src/incremental/file-hashes.ts`
- Create: `arch-engine/tests/incremental/file-hashes.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { hashFileContent, collectTrackedSourceHashes } from "../../src/incremental/file-hashes.js";

describe("file-hashes", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fh-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("hashFileContent is stable for same bytes", async () => {
    const f = path.join(tmp, "a.java");
    await fs.writeFile(f, "public class A {}", "utf-8");
    const h1 = await hashFileContent(f);
    const h2 = await hashFileContent(f);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("collectTrackedSourceHashes returns relative posix paths", async () => {
    await fs.mkdir(path.join(tmp, "mod", "src"), { recursive: true });
    await fs.writeFile(path.join(tmp, "mod", "src", "FooUtils.java"), "class FooUtils {}", "utf-8");
    const map = await collectTrackedSourceHashes(tmp, [
      { slug: "mod", path: "mod", sourcePath: "mod" },
    ], []);
    expect(map.mod?.["mod/src/FooUtils.java"]).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: 运行确认 FAIL**

Run: `cd arch-engine && npm test -- tests/incremental/file-hashes.test.ts`  
Expected: FAIL module not found

- [ ] **Step 3: 实现 file-hashes.ts**

```typescript
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { FrontendPackage, JavaModule } from "../types.js";

export async function hashFileContent(absPath: string): Promise<string> {
  const buf = await fs.readFile(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const JAVA_GLOB = "**/*.java";
const TS_GLOBS = ["**/*.{ts,tsx}", "**/*.{js,jsx}"];

async function hashesUnder(
  projectRoot: string,
  relDir: string,
  globs: string[],
  ignore: string[]
): Promise<Record<string, string>> {
  const cwd = path.join(projectRoot, relDir);
  const files = await fg.glob(globs, { cwd, absolute: true, ignore });
  const out: Record<string, string> = {};
  for (const abs of files) {
    const rel = path.relative(projectRoot, abs).replace(/\\/g, "/");
    out[rel] = await hashFileContent(abs);
  }
  return out;
}

export async function collectTrackedSourceHashes(
  projectRoot: string,
  modules: Pick<JavaModule, "slug" | "path">[],
  packages: Pick<FrontendPackage, "slug">[],
  packageDirs: Map<string, string>
): Promise<Record<string, Record<string, string>>> {
  const result: Record<string, Record<string, string>> = {};
  const ignore = ["**/node_modules/**", "**/target/**", "**/dist/**", "**/.ai/**"];

  for (const mod of modules) {
    result[mod.slug] = await hashesUnder(projectRoot, mod.path, [JAVA_GLOB], ignore);
  }
  for (const pkg of packages) {
    const dir = packageDirs.get(pkg.slug) ?? pkg.slug;
    result[pkg.slug] = await hashesUnder(projectRoot, dir, TS_GLOBS, ignore);
  }
  return result;
}
```

- [ ] **Step 4: 运行测试 PASS**

Run: `cd arch-engine && npm test -- tests/incremental/file-hashes.test.ts`

- [ ] **Step 5: Commit**

```bash
git add arch-engine/src/incremental/file-hashes.ts arch-engine/tests/incremental/file-hashes.test.ts
git commit -m "feat(arch-engine): add file hash collection for nogit audit"
```

## Task B1.2: pipeline 写入 fileHashes

**Files:**
- Modify: `arch-engine/src/pipeline.ts`（`buildLastScanState` 调用处、`writeLastScan` 之前）

- [ ] **Step 1: 在 `runStartInit` 末尾、`writeLastScan` 之前收集 hashes**

在 `pipeline.ts` 顶部增加：

```typescript
import { collectTrackedSourceHashes } from "./incremental/file-hashes.js";
```

在 `const commit = getCurrentCommit(projectRoot);` 之前插入：

```typescript
  const fileHashMap = await collectTrackedSourceHashes(
    projectRoot,
    model.modules,
    model.packages,
    packageDirs
  );
```

修改 `buildLastScanState` 签名，增加参数 `fileHashMap: Record<string, Record<string, string>>`，在 modules/packages 循环内：

```typescript
    modulesState[mod.slug] = {
      sourcePath: mod.path,
      assetCount: moduleAssetCounts.get(mod.slug) ?? modulesState[mod.slug]?.assetCount ?? 0,
      fileHashes: fileHashMap[mod.slug] ?? {},
    };
```

packages 同理使用 `fileHashMap[pkg.slug]`。

- [ ] **Step 2: 扩展 last-scan 测试**

在 `arch-engine/tests/incremental/last-scan.test.ts` 增加断言：`fileHashes` 可读写非空对象（可用 mock，或集成测在 pipeline 测试夹具中验证）。

- [ ] **Step 3: 全量测试**

Run: `cd arch-engine && npm test`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add arch-engine/src/pipeline.ts arch-engine/tests/incremental/last-scan.test.ts
git commit -m "feat(arch-engine): persist fileHashes in last-scan.json after start-init"
```

## Task B1.3: mapFileToCandidate

**Files:**
- Create: `arch-engine/src/discovery/map-file.ts`
- Modify: `arch-engine/src/scanners/java-assets.ts`（导出 `classifyJavaFile` 或抽到共享）

- [ ] **Step 1: 从 `java-assets.ts` 导出 `classifyJavaFile`**

将 `classifyJavaFile` 改为 `export function classifyJavaFile(...)`（保持签名不变）。

- [ ] **Step 2: 实现 map-file.ts**

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { classifyJavaFile } from "../scanners/java-assets.js";
import { parseFeignInterface } from "../scanners/java-feign.js";
import type { RawCandidate } from "../types.js";

export async function mapFileToCandidate(
  projectRoot: string,
  sourcePath: string,
  moduleSlug: string
): Promise<RawCandidate | null> {
  const rel = sourcePath.replace(/\\/g, "/");
  const abs = path.resolve(projectRoot, rel);
  let content: string;
  try {
    content = await fs.readFile(abs, "utf-8");
  } catch {
    return null;
  }

  if (rel.endsWith(".java")) {
    const classified = classifyJavaFile(content, abs);
    if (!classified) return null;
    const extra: Record<string, string> = {};
    if (classified.kind === "rpc") {
      const feign = parseFeignInterface(content);
      if (feign?.clientRef) extra.clientRef = feign.clientRef;
    }
    return {
      kind: classified.kind,
      name: classified.name,
      moduleSlug,
      filePath: rel,
      javadoc: "",
      signatures: [],
      extra,
    };
  }

  // TS/前端：v1 仅处理 .ts/.tsx 下 PascalCase 文件名作为 component 候选
  if (/\.(tsx?|jsx?)$/.test(rel)) {
    const base = path.basename(rel, path.extname(rel));
    if (!/^[A-Z]/.test(base)) return null;
    return {
      kind: "component",
      name: base,
      moduleSlug,
      filePath: rel,
      javadoc: "",
      signatures: [],
      extra: {},
    };
  }

  return null;
}
```

- [ ] **Step 3: Commit**

```bash
git add arch-engine/src/discovery/map-file.ts arch-engine/src/scanners/java-assets.ts
git commit -m "feat(arch-engine): map single source file to RawCandidate"
```

## Task B1.4: auditArchChanges 核心

**Files:**
- Create: `arch-engine/src/audit/ignore.ts`
- Create: `arch-engine/src/audit/changes.ts`
- Create: `arch-engine/tests/audit/changes.test.ts`

- [ ] **Step 1: ignore.ts**

```typescript
const IGNORE_SEGMENTS = ["/.ai/", "/node_modules/", "/target/", "/dist/", "/.git/"];

export function shouldIgnoreAuditPath(relPath: string): boolean {
  const p = `/${relPath.replace(/\\/g, "/")}/`;
  return IGNORE_SEGMENTS.some((seg) => p.includes(seg));
}
```

- [ ] **Step 2: 写 audit 失败测试（nogit modified）**

```typescript
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { auditArchChanges } from "../../src/audit/changes.js";
import { writeLastScan } from "../../src/incremental/last-scan.js";
import { hashFileContent } from "../../src/incremental/file-hashes.js";
import { registerAssetInArch } from "../../src/register-asset.js";
import { DEFAULT_CONFIG } from "../../src/config.js";

// 复用 register-asset.test 的 mockFetch 模式
```

测试用例至少包含：
1. **nogit modified**：注册资产 → 改 Java 文件 → 更新 last-scan 中该路径 hash 为旧值 → audit 报 `modified`
2. **unregistered**：新 `BarUtils.java` 无 register → audit 报 `unregistered`
3. **无 last-scan**：仅 `unregistered` 或空 anchor 提示

- [ ] **Step 3: 实现 changes.ts 骨架**

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { getChangedFilesSince, getCurrentCommit, isGitRepo } from "../incremental/git-diff.js";
import { readLastScan } from "../incremental/last-scan.js";
import { hashFileContent } from "../incremental/file-hashes.js";
import { loadArchIndex } from "../writer/arch-index.js";
import { VectorStore } from "../vector/sqlite-store.js";
import { getVectorsDbPath } from "../paths.js";
import { mapFileToCandidate } from "../discovery/map-file.js";
import { shouldIgnoreAuditPath } from "./ignore.js";
import { buildAssetId } from "../asset/id.js";
import type { AssetKind } from "../types.js";

export interface AuditItem {
  sourcePath: string;
  assetId?: string;
  suggestedKind?: AssetKind;
  suggestedName?: string;
  module?: string;
  reason?: string;
}

export interface AuditArchChangesResult {
  anchor: { commit: string; scannedAt?: string; mode: "git" | "fileHashes" };
  new: AuditItem[];
  modified: AuditItem[];
  deleted: AuditItem[];
  unregistered: AuditItem[];
}

export interface AuditArchChangesOptions {
  since?: string;
  paths?: string[];
}

function sourcePathToAssetIds(
  store: VectorStore,
  sourcePath: string
): string[] {
  const hits = store.searchBySourcePath?.(sourcePath) ?? [];
  return [...new Set(hits.map((h) => h.assetId).filter(Boolean))] as string[];
}

export async function auditArchChanges(
  projectRoot: string,
  options: AuditArchChangesOptions = {}
): Promise<AuditArchChangesResult> {
  const last = await readLastScan(projectRoot);
  const useGit = isGitRepo(projectRoot) && last?.commit && last.commit !== "nogit";
  const changedFiles = new Set<string>();

  if (useGit && last) {
    const since = options.since && options.since !== "last-scan" ? options.since : last.commit;
    for (const f of getChangedFilesSince(projectRoot, since)) {
      if (!shouldIgnoreAuditPath(f)) changedFiles.add(f);
    }
  } else if (last) {
    for (const [slug, entry] of Object.entries({ ...last.modules, ...last.packages })) {
      for (const [rel, oldHash] of Object.entries(entry.fileHashes ?? {})) {
        try {
          const cur = await hashFileContent(path.join(projectRoot, rel));
          if (cur !== oldHash) changedFiles.add(rel);
        } catch {
          // deleted file handled below
        }
      }
    }
  }

  // paths 过滤
  if (options.paths?.length) {
    const allow = new Set(options.paths.map((p) => p.replace(/\\/g, "/")));
    for (const f of [...changedFiles]) {
      if (!allow.has(f)) changedFiles.delete(f);
    }
  }

  const result: AuditArchChangesResult = {
    anchor: {
      commit: last?.commit ?? getCurrentCommit(projectRoot),
      scannedAt: last?.scannedAt,
      mode: useGit ? "git" : "fileHashes",
    },
    new: [],
    modified: [],
    deleted: [],
    unregistered: [],
  };

  const store = new VectorStore(getVectorsDbPath(projectRoot));
  try {
    const indexedPaths = store.listSourcePaths?.() ?? [];
    const indexedSet = new Set(indexedPaths);

    for (const rel of changedFiles) {
      const ids = sourcePathToAssetIds(store, rel);
      const moduleSlug = rel.split("/")[0] ?? "unknown";
      const candidate = await mapFileToCandidate(projectRoot, rel, moduleSlug);
      if (ids.length > 0) {
        result.modified.push({
          sourcePath: rel,
          assetId: ids[0],
          suggestedKind: candidate?.kind,
          suggestedName: candidate?.name,
          module: candidate?.moduleSlug ?? moduleSlug,
          reason: "source changed since anchor",
        });
      } else if (candidate) {
        result.unregistered.push({
          sourcePath: rel,
          suggestedKind: candidate.kind,
          suggestedName: candidate.name,
          module: candidate.moduleSlug,
          reason: "discoverable asset not in index",
        });
      }
    }

    // deleted: indexed path missing on disk
    for (const rel of indexedSet) {
      if (shouldIgnoreAuditPath(rel)) continue;
      try {
        await fs.access(path.join(projectRoot, rel));
      } catch {
        const ids = sourcePathToAssetIds(store, rel);
        for (const id of ids) {
          result.deleted.push({
            sourcePath: rel,
            assetId: id,
            reason: "source file removed",
          });
        }
      }
    }
  } finally {
    store.close();
  }

  return result;
}
```

- [ ] **Step 4: 在 VectorStore 增加辅助方法**

Modify: `arch-engine/src/vector/sqlite-store.ts`

```typescript
  listSourcePaths(): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT source_path FROM chunks WHERE source_path IS NOT NULL`)
      .all() as { source_path: string }[];
    return rows.map((r) => r.source_path);
  }

  searchBySourcePath(sourcePath: string): SearchHit[] {
    const rows = this.db
      .prepare(
        `SELECT id, path, anchor, kind, title, summary, source_path FROM chunks WHERE source_path = ?`
      )
      .all(sourcePath) as ChunkRow[];
    return rows.map((r) => ({
      assetId: r.id,
      path: r.path,
      anchor: r.anchor ?? undefined,
      kind: r.kind,
      title: r.title,
      summary: r.summary,
      score: 1,
      sourcePath: r.source_path ?? undefined,
    }));
  }
```

- [ ] **Step 5: 运行 audit 测试 PASS**

Run: `cd arch-engine && npm test -- tests/audit/changes.test.ts`

- [ ] **Step 6: export + Commit**

在 `arch-engine/src/index.ts` export `auditArchChanges` 与类型。

```bash
git add arch-engine/src/audit arch-engine/tests/audit arch-engine/src/vector/sqlite-store.ts arch-engine/src/index.ts
git commit -m "feat(arch-engine): add auditArchChanges for git and nogit projects"
```

## Task B1.5: MCP audit_arch_changes

**Files:**
- Create: `mcp-server/src/audit-changes.ts`
- Modify: `mcp-server/src/index.ts`
- Create: `mcp-server/tests/audit-changes.test.ts`

- [ ] **Step 1: audit-changes.ts**

```typescript
import { auditArchChanges, type AuditArchChangesOptions } from "@apt/arch-engine";

export async function handleAuditArchChanges(
  projectRoot: string,
  options: AuditArchChangesOptions = {}
) {
  return auditArchChanges(projectRoot, options);
}
```

- [ ] **Step 2: 在 index.ts 注册 tool**

```typescript
import { handleAuditArchChanges } from "./audit-changes.js";

server.tool(
  "audit_arch_changes",
  "Report architecture asset changes since last scan (modified, new, deleted, unregistered)",
  {
    since: z.string().optional().describe('Anchor: "last-scan" (default), commit-ish, or HEAD'),
    paths: z.array(z.string()).optional().describe("Limit to these relative source paths"),
  },
  async ({ since, paths }) => {
    try {
      const result = await handleAuditArchChanges(projectRoot, {
        since: since ?? "last-scan",
        paths,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `❌ ${String(err)}` }],
        isError: true,
      };
    }
  }
);
```

- [ ] **Step 3: 测试 + 全量 mcp-server test**

Run: `cd mcp-server && npm test`

- [ ] **Step 4: Commit**

```bash
git add mcp-server/src/audit-changes.ts mcp-server/src/index.ts mcp-server/tests/audit-changes.test.ts
git commit -m "feat(mcp): expose audit_arch_changes tool"
```

**Block B1 Gate:** `cd arch-engine && npm test && cd ../mcp-server && npm test` 全绿；临时项目上 `audit_arch_changes` 返回 JSON。

---

# Block B2: refresh_asset

**Handoff 给 B3：** `refreshAssetInArch` 从源码 summarize 后 upsert；MCP `refresh_asset` 可用。

## Task B2.1: refreshAssetInArch

**Files:**
- Create: `arch-engine/src/refresh/asset.ts`
- Create: `arch-engine/tests/refresh/asset.test.ts`

- [ ] **Step 1: 失败测试（mock summarize）**

测试流程：
1. 准备 arch.config + arch-index + `JsonUtils.java`
2. 先 `registerAssetInArch` 写入旧 summary
3. 修改 Java 文件内容（加方法）
4. `refreshAssetInArch(tmpRoot, { sourcePath: "demo/src/JsonUtils.java" })`
5. 读 `utils.md`，断言 summary 来自 summarize mock（非旧手写文案）
6. VectorStore 中 `sourcePath` 仍为该文件

- [ ] **Step 2: 实现 refresh/asset.ts**

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { buildAssetId } from "../asset/id.js";
import { assetCardsToChunks } from "../asset/chunks-from-cards.js";
import { loadOrInitConfig } from "../config.js";
import { mapFileToCandidate } from "../discovery/map-file.js";
import { embedTexts } from "../embedding/openai-compatible.js";
import { getArchConfigPath, getVectorsDbPath } from "../paths.js";
import {
  inferAssetScope,
  patchArchIndexForAsset,
} from "../register-asset.js";
import { summarizeCandidates, type SummarizeFn } from "../summarize/batch.js";
import { loadArchIndex, writeArchIndex, writeIndexMd } from "../writer/arch-index.js";
import { upsertAssetCardInModuleDoc } from "../writer/asset-md.js";
import type { AssetKind } from "../types.js";
import { VectorStore } from "../vector/sqlite-store.js";

export interface RefreshAssetInput {
  sourcePath: string;
  kind?: AssetKind;
  name?: string;
  module?: string;
}

export interface RefreshAssetResult {
  ok: true;
  id: string;
  path: string;
  action: "created" | "updated";
}

export interface RefreshAssetDeps {
  summarizeFn?: SummarizeFn;
}

export async function refreshAssetInArch(
  projectRoot: string,
  input: RefreshAssetInput,
  deps: RefreshAssetDeps = {}
): Promise<RefreshAssetResult> {
  const rel = input.sourcePath.replace(/\\/g, "/");
  const abs = path.resolve(projectRoot, rel);
  await fs.access(abs);
  await fs.access(getArchConfigPath(projectRoot));

  const { config } = await loadOrInitConfig(projectRoot);
  const index = await loadArchIndex(projectRoot);

  const moduleSlug =
    input.module ?? rel.split("/")[0] ?? "unknown";
  const candidate =
    (await mapFileToCandidate(projectRoot, rel, moduleSlug)) ??
    (() => {
      throw new Error(`Cannot infer asset from source: ${rel}`);
    })();

  if (input.kind) candidate.kind = input.kind;
  if (input.name) candidate.name = input.name;
  if (input.module) candidate.moduleSlug = input.module;

  const scope = inferAssetScope(index, candidate.moduleSlug, rel, candidate.kind);
  const cards = await summarizeCandidates(
    config,
    [candidate],
    scope,
    candidate.moduleSlug,
    { batchSize: 1, summarizeFn: deps.summarizeFn, scope }
  );
  const card = cards[0]!;
  card.id = buildAssetId(scope, card.module, card.kind, card.name);
  card.path = rel;
  card.source = "refresh";

  const existed = Boolean(index.nodes[`${scope}/${card.module}/${card.kind}`]?.anchors?.includes(card.name));

  await upsertAssetCardInModuleDoc(projectRoot, card, scope);
  patchArchIndexForAsset(index, card, scope);
  await writeArchIndex(projectRoot, index);
  await writeIndexMd(projectRoot, index);

  const chunks = assetCardsToChunks([card], scope);
  const embeddings = await embedTexts(config, chunks.map((c) => c.text));
  const store = new VectorStore(getVectorsDbPath(projectRoot));
  try {
    store.upsertChunks(
      chunks.map((c, i) => ({
        meta: c,
        embedding: embeddings[i]!,
        sourcePath: rel,
      }))
    );
  } finally {
    store.close();
  }

  return {
    ok: true,
    id: card.id,
    path: `${scope}/${card.module}/${card.kind}`,
    action: existed ? "updated" : "created",
  };
}
```

- [ ] **Step 3: export + 测试 PASS**

Run: `cd arch-engine && npm test -- tests/refresh/asset.test.ts`

- [ ] **Step 4: Commit**

```bash
git add arch-engine/src/refresh arch-engine/tests/refresh arch-engine/src/index.ts
git commit -m "feat(arch-engine): refresh single asset from source via summarize"
```

## Task B2.2: MCP refresh_asset

**Files:**
- Create: `mcp-server/src/refresh-asset.ts`
- Modify: `mcp-server/src/index.ts`

- [ ] **Step 1–4:** 照 `register-asset.ts` 模式注册 `refresh_asset`（参数：`sourcePath` 必填，`kind`/`name`/`module` 可选）

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mcp): expose refresh_asset tool"
```

**Block B2 Gate:** 修改 Utils.java → `refresh_asset` → `search_arch` 摘要变化。

---

# Block B3: remove_asset + sync-changes CLI

**Handoff 给 B4：** `sync-changes --dry-run` 只报告；无 dry-run 时批量 refresh/remove。

## Task B3.1: removeAssetFromArch

**Files:**
- Modify: `arch-engine/src/writer/asset-md.ts`
- Create: `arch-engine/src/remove/asset.ts`
- Create: `arch-engine/tests/remove/asset.test.ts`

- [ ] **Step 1: removeAssetSectionFromMarkdown**

```typescript
export function removeAssetSectionFromMarkdown(existingMd: string, assetName: string): string {
  const header = `## ${assetName}`;
  const lines = existingMd.split("\n");
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === header) {
      start = i;
      continue;
    }
    if (start !== -1 && (/^## /.test(lines[i]!) || /^# /.test(lines[i]!))) {
      end = i;
      break;
    }
  }
  if (start === -1) return existingMd;
  const before = lines.slice(0, start).join("\n").trimEnd();
  const after = lines.slice(end).join("\n").trimStart();
  const joined = [before, after].filter((p) => p.length > 0).join("\n\n");
  return joined.length > 0 ? `${joined}\n` : renderKindFile("util", []).split("\n").slice(0, 2).join("\n") + "\n";
}
```

（实现时传入正确 `kind` 给空文件 fallback。）

- [ ] **Step 2: remove/asset.ts** — 解析 `assetId` 或 `sourcePath` → 删 md 段 → `deleteByIds` → 更新 arch-index anchors/chunks

- [ ] **Step 3: 测试** — register 后 remove → search 无命中

- [ ] **Step 4: Commit**

## Task B3.2: runSyncChanges 编排

**Files:**
- Create: `arch-engine/src/sync/run.ts`
- Create: `arch-engine/tests/sync/run.test.ts`

- [ ] **Step 1: 实现 runSyncChanges**

```typescript
export interface SyncChangesOptions {
  dryRun?: boolean;
  since?: string;
  paths?: string[];
}

export interface SyncChangesReport {
  audit: AuditArchChangesResult;
  refreshed: RefreshAssetResult[];
  removed: { assetId: string; sourcePath?: string }[];
  errors: { sourcePath?: string; assetId?: string; message: string }[];
}

export async function runSyncChanges(
  projectRoot: string,
  options: SyncChangesOptions = {},
  deps: RefreshAssetDeps = {}
): Promise<SyncChangesReport> {
  const audit = await auditArchChanges(projectRoot, {
    since: options.since,
    paths: options.paths,
  });
  const report: SyncChangesReport = {
    audit,
    refreshed: [],
    removed: [],
    errors: [],
  };
  if (options.dryRun) return report;

  const toRefresh = [...audit.modified, ...audit.unregistered, ...audit.new];
  for (const item of toRefresh) {
    try {
      const r = await refreshAssetInArch(
        projectRoot,
        {
          sourcePath: item.sourcePath,
          kind: item.suggestedKind,
          name: item.suggestedName,
          module: item.module,
        },
        deps
      );
      report.refreshed.push(r);
    } catch (e) {
      report.errors.push({ sourcePath: item.sourcePath, message: String(e) });
    }
  }
  for (const item of audit.deleted) {
    if (!item.assetId) continue;
    try {
      await removeAssetFromArch(projectRoot, { assetId: item.assetId });
      report.removed.push({ assetId: item.assetId, sourcePath: item.sourcePath });
    } catch (e) {
      report.errors.push({ assetId: item.assetId, message: String(e) });
    }
  }
  return report;
}
```

- [ ] **Step 2: dry-run 测试** — `dryRun: true` 时 vectors 行数不变

- [ ] **Step 3: Commit**

## Task B3.3: CLI + bin

**Files:**
- Create: `arch-engine/src/cli-sync.ts`
- Modify: `arch-engine/package.json`（`"sync-changes": "dist/cli-sync.js"`）
- Create: `bin/sync-changes.ps1`, `bin/sync-changes.sh`, `bin/sync-changes.cmd`

- [ ] **Step 1: cli-sync.ts** — 解析 `--dry-run`、`--paths a,b`、`--since`；打印 JSON 或表格 summary；失败 exit 1

- [ ] **Step 2: bin 脚本**（照 `start-init.ps1`）

```powershell
$aptHome = if ($env:APT_HOME) { $env:APT_HOME } else { Join-Path $env:USERPROFILE ".apt" }
node (Join-Path $aptHome "arch-engine/dist/cli-sync.js") @args
```

- [ ] **Step 3: build + 测试**

Run: `cd arch-engine && npm run build && npm test`

- [ ] **Step 4: MCP remove_asset** — `mcp-server/src/remove-asset.ts` + index 注册

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add remove_asset, sync-changes CLI, and sync orchestration"
```

**Block B3 Gate:** `sync-changes --dry-run` 与 `audit_arch_changes` 输出一致；非 dry-run 修复一个 modified 资产。

---

# Block B4: 命令模板 + 可选 sync_arch_changes

**Handoff 给 B5：** 用户可用 `/feature`；`start-feature` 文末要求自动闭环；`finish-feature` 为补救。

## Task B4.1: _feature-closeout.md

**Files:**
- Create: `templates/_feature-closeout.md`

- [ ] **Step 1: 写入完整 closeout 正文**

```markdown
你已完成核心实现，**必须**执行下列闭环（禁止跳过）。

## 0. 架构变更同步（必须）

1. 调用 **`audit_arch_changes`**（默认 `since: last-scan`）。无 `last-scan.json` 时报告需先 `start-init`。
2. 对 **`modified`** 每一项：调用 **`refresh_asset`**（`sourcePath` 必填）。禁止仅用旧 summary 调 `register_asset` 代替。
3. 对 **`new`** / **`unregistered`**：调用 **`refresh_asset`**（从源码入库）。
4. 对 **`deleted`**：调用 **`remove_asset`**（`assetId` 或 `sourcePath`）。
5. 若四类皆空：在报告中写明「无架构资产变更」。

可选补救：在项目根执行 `sync-changes` 或 `sync-changes --dry-run` 预览。

## 1. TS 契约（若有对外 TS 类型）

1. 检查是否新建可供外部调用的接口、类或函数。
2. 确保 `src/contracts/` 或对应目录有严格 TS 类型定义。
3. 每个新契约调用 **`register_contract`**（`name`, `description`, `tsFilePath`）。

## 2. 验证

- 每个 `register_contract`：确认 `.ai/INDEX.md` 已更新。
- 每个 refresh/remove：用 **`search_arch`** 抽检；精读用 **`query_arch`**。
- 输出 **闭环摘要**：audit 统计、已 refresh 的 assetId 列表、已注册契约列表。
```

- [ ] **Step 2: Commit**

## Task B4.2: feature.md + 更新 start/finish

**Files:**
- Create: `templates/feature.md`
- Modify: `templates/start-feature.md`
- Modify: `templates/finish-feature.md`
- Modify: `.claude/commands/*.md`（若仓库内有一份，与 templates 同步）

- [ ] **Step 1: feature.md** — frontmatter + Phase 1–2 复制 `start-feature` §0–2 + Phase 3 **完整粘贴** `_feature-closeout.md` 正文（顶部注释：`<!-- keep in sync with templates/_feature-closeout.md -->`）

- [ ] **Step 2: start-feature.md 追加 §3**

```markdown
## 3. 实现与自动闭环（必须）

用户确认后进入实现。当实现完成且可以交付时：

1. **不要**等待用户输入 `/finish-feature`。
2. **立即**执行与 `finish-feature` 相同的闭环（见下方 closeout 步骤）。
3. 最终报告单独列出 **「闭环摘要」**。

（此处粘贴与 `_feature-closeout.md` 相同正文）

若本次仅做计划、尚未写代码，则不要执行闭环。
```

- [ ] **Step 3: finish-feature.md** — description 改为补救说明；正文仅 closeout

- [ ] **Step 4: Commit**

## Task B4.3: agent-init 排除 `_*.md`

**Files:**
- Modify: `bin/agent-init.ps1`
- Modify: `bin/agent-init.sh`

- [ ] **Step 1: 只复制非下划线开头的模板**

PowerShell:

```powershell
Get-ChildItem (Join-Path $aptHome "templates\*.md") | Where-Object { -not $_.Name.StartsWith("_") } | Copy-Item -Destination (Join-Path $target ".claude\commands\") -Force
```

- [ ] **Step 2: Commit**

## Task B4.4: 可选 MCP sync_arch_changes

**Files:**
- Create: `mcp-server/src/sync-changes.ts`

- [ ] **Step 1: 封装 `runSyncChanges`**，参数 `dryRun?: boolean`, `paths?: string[]`

- [ ] **Step 2: Commit**

**Block B4 Gate:** `agent-init` 后项目有 `feature.md`、`start-feature.md`、`finish-feature.md`，**无** `_feature-closeout.md`。

---

# Block B5: README + install + chongqing 狗食

## Task B5.1: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 新增「开发后同步架构」小节**

包含：
- 推荐 `/feature` 单命令流
- `start-feature` 自动闭环 vs `finish-feature` 补救
- 选型表：`sync-changes` vs `start-init --incremental` vs `--full`
- MCP 工具列表：`audit_arch_changes`, `refresh_asset`, `remove_asset`

- [ ] **Step 2: Commit**

## Task B5.2: install 验证

- [ ] **Step 1: 全量 install**

Run: `F:/software/claude_plugin/scripts/install.ps1`  
Expected: `sync-changes` 出现在 `%USERPROFILE%\.apt\bin\`

- [ ] **Step 2: chongqing 狗食**

Run（在 `E:\chongqing`）:

```powershell
& "$env:USERPROFILE\.apt\bin\agent-init.ps1" E:\chongqing
sync-changes --dry-run
```

记录：anchor mode 应为 `fileHashes`；修改一个已索引 Java 文件后再 dry-run 应出现 `modified`。

- [ ] **Step 3: 在 plan 或 checkpoint 记录狗食结果**（不强制 commit）

**Block B5 Gate:** install 成功；chongqing dry-run 行为符合 spec §11。

---

## Spec 覆盖自检

| Spec 章节 | 对应 Block / Task |
|-----------|-------------------|
| §4 audit_arch_changes | B1 Task B1.4–B1.5 |
| §5 refresh_asset | B2 |
| §6 remove_asset | B3 Task B3.1 |
| §7 sync-changes CLI | B3 Task B3.2–B3.3 |
| §8 命令模板方案 C | B4 |
| §9 MCP 清单 | B1.5, B2.2, B3.4, B4.4 |
| §10 一致性 buildAssetId | B2 refresh 使用 `buildAssetId` |
| §11 测试计划 | 各 Block 测试任务 |
| §12 文档 | B5 |
| §13 P0–P3 分期 | B1=P0, B2–B3=P1, B4=P2, B5=P3 |
| nogit fileHashes P0 | B1 Task B1.1–B1.2 |

**Placeholder 扫描:** 无 TBD；各 Task 含可执行命令与代码骨架。

---

## 执行交接

Plan 已保存至 `docs/superpowers/plans/2026-06-16-arch-sync-changes.md`。

**已选执行方式：Inline（executing-plans）+ 可选受限子 Agent**

1. 主会话串行 B0→B5，每 Block checkpoint  
2. B1–B3 可将**纯代码**派给子 Agent，Gate 与 MCP 由主 Agent 执行  
3. B4 模板、B5 狗食由主 Agent 做；Vercel/Figma/browse **仅**在验 chongqing 前端时需要  

**下一步：** 从 **Block B0** 开始。若 B0 已在工作区完成，主 Agent 先跑 Gate 再进 **B1**。
