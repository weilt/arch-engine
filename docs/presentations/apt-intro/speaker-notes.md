# APT 宣讲 — 演讲者备注

总时长约 15–20 分钟（约 1 分钟/页）。页上文字极简，以下内容供口头展开。

---

## Slide 1 — 封面（~1 min）

大家好，今天介绍 **Agent-Protocol-Toolkit**，简称 APT。一句话：让 Claude Code 等多代理开发「有规矩」。我们从 Prompt 的软约束，升级到 MCP 的硬约束。

**提示听众：** 口播与 `source.md` 已与 README 同步；若投影 ppt 上数字仍为旧版，以口播为准（幻灯片图像下轮重生成）。

---

## Slide 2 — 痛点（~1.5 min）

在座做 AI 编程的应该都有体会：长任务里模型会**编造类型**——没查接口就写代码；会**重复造轮子**——项目里明明有工具类它不知道；更麻烦的是**做完不登记**——下一个代理或下一个会话又从零猜。

对技术负责人来说，这是质量不可控、架构文档永远追不上代码、多代理协作无法审计。

---

## Slide 3 — 转折（~1 min）

我们在 Prompt 里写「请先查契约」——有用，但不可靠。APT 的核心思路：**把规则写进 MCP**。代理必须调工具，查不到就 `report_missing` 阻塞，不能偷偷编造。这是软约束和硬约束的区别。

---

## Slide 4 — 是什么（~1.5 min）

APT 是全局安装、按项目激活的工具集。四层机制：

1. **七个斜杠命令** — 编排寻址、计划、实现、验收、闭环
2. **15 个 MCP 工具** — 契约、架构、设计三类硬约束
3. **架构引擎** — `start-init` 扫描代码进向量库
4. **项目 .ai/ 数据** — 契约库、架构文档、设计知识

30 秒记住：命令编排流程，MCP 守门知识。

---

## Slide 5 — 架构图（~1.5 min）

给架构师看的数据流：开发者发命令 → 子代理调 MCP → 读写项目 `.ai/` → `arch-engine` 负责扫描索引。

**不变层**是 MCP Server 和 arch-engine，**项目层**是各业务仓库的 `.ai/`。换项目换数据，工具不变。`APT_PROJECT_ROOT` 确保 MCP 读对项目根。

---

## Slide 6 — 工作流（~1 min）

两条路：有 brainstorming spec 走 `/plan-from-spec` → 审阅 → `/implement-plan` → **`/verify` 验收**（含 UI 时含设计 audit 只读）；口头描述走 `/feature` → **`/verify`**。验收 FAIL 才用 `/finish-feature` 补救写侧闭环。

---

## Slide 7 — MCP 亮点（~1.5 min）

15 个工具分三组，各举一个：

- **契约**：`query_contract("UserDTO")` 查类型，没有就阻塞
- **架构**：`search_arch("用户登录")` 语义搜索，带 sourcePath 跳源码
- **设计**：`query_design` 查 token；`audit_design_changes` 验收设计漂移；`report_design_gap` 阻止瞎画 UI

---

## Slide 8 — 命令一览（~1 min）

七个命令：`/plan-from-spec`、`/implement-plan`、`/feature`、`/verify`、`/finish-feature`、`/design-system`、`/design-page`。重点：`/verify` 是读侧验收门禁（含 UI 时设计 audit）；`/finish-feature` 只在 verify 失败或漏跑闭环时用。

---

## Slide 9 — 多平台（~1 min）

一套 MCP，**五个**平台：Claude Code、Cursor、Qoder、Codex、**ZCode**。`agent-init` 把命令/Skills 写到各平台路径；MCP 含 `APT_PROJECT_ROOT`。

ZCode 补充：`/` 命令与 `$apt-*` Skill 打开项目即见；**MCP 要在 Settings 里 Import 或手动配**——有命令无 MCP 无法硬约束寻址。幻灯片图像若仍画四节点，以本口播为准（下轮重生成 pptx）。

---

## Slide 10 — Before/After（~1.5 min）

给 lead 的 ROI：以前接口靠猜、架构靠人记、做完知识丢；有 APT 后接口可查可阻塞、架构可搜可同步、做完自动 audit + register。多代理真正能「接力」。

---

## Slide 11 — 案例叙事（~2 min）

假设加 OAuth 登录：`/feature` → 查 UserDTO 契约 → search 认证 API → 有 UI 则 query_design → 实现 → audit_arch_changes → refresh_asset → register_contract → **`/verify` 验收** → 下一代理接力。这是故事板，不是 live demo。

---

## Slide 12 — 设计层（~1 min）

有前端团队的额外价值：设计知识层框架无关，baoyu-design 定稿后 `design-sync` 进 `.ai/design/`，可选 `design-bindings` 映射组件库。Phase 1–3 已补齐。开发先查设计再写 UI，和契约、架构形成三层硬约束。

---

## Slide 13 — 开始用（~0.5 min）

安装和第一次 `agent-init` 请看 README — github.com/weilt/arch-engine。幻灯片不重复文档。

---

## Slide 14 — 社区（~0.5 min）

项目试用中，欢迎 Star、提 Issue、PR。我们一起把多代理开发做「有规矩」。

---

## Slide 15 — 收尾（~1 min）

记住三句话：**先查再写，缺依赖必阻塞，做完必登记**。有问题欢迎交流，仓库 github.com/weilt/arch-engine。谢谢！
