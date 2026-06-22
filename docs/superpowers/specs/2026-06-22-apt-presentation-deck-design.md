# APT 宣讲幻灯片：生成与分享

**日期:** 2026-06-22  
**状态:** 已批准（brainstorming 确认）  
**关系:** 为 APT 仓库提供对外宣讲 PPT，并沉淀可复用的 deck 生成流程  
**方案:** `README.md` 内容真源 + `baoyu-slide-deck` 生成 PPTX/PDF + `speaker-notes.md` 现场口播

---

## 1. 目标

为 **Agent-Protocol-Toolkit (APT)** 制作一份可用于现场宣讲的幻灯片，并建立可复用流程，使维护者在 README 更新后能重新生成 deck。

| 维度 | 决策 |
|------|------|
| 用途 | 对外宣讲推广（技术分享、内部分享、开源社区介绍） |
| 听众 | 一线开发者 + 技术负责人/架构师（价值层 + 技术锚点双层叙事） |
| 场景 | 现场演讲 15–20 分钟，幻灯片辅助、演讲者口头展开 |
| 上手教程 | 由 `README.md` 承担，不进 PPT |
| 贡献指南 | 后续单独提供，可写入 `README.md`，不进本阶段 PPT |
| 交付 | **A** 第一版宣讲 PPT + **B** 可复用生成能力（`templates/apt-deck.md` + 模板目录） |
| 生成引擎 | **`baoyu-slide-deck`**（baoyu-skills）→ PPTX/PDF |

---

## 2. 非目标

- 不把 `baoyu-slide-deck` 打包进 APT `install.ps1` / `install.sh`（外部 skill，用户自行安装 baoyu-skills）
- 不做 MCP 工具封装幻灯片生成
- 不在 PPT 中展开 README 级安装步骤、贡献指南
- 不把 `apt-deck` 纳入 `agent-init` 向业务项目分发（仅 APT 仓库维护者工具）
- 本阶段不做 Marp/reveal.js 作为主生成路径（图像 deck 由 baoyu 统一产出）

---

## 3. 方案选型

brainstorming 阶段评估了三种方案：

| 方案 | 描述 | 结论 |
|------|------|------|
| 1 Marp Markdown | 文本幻灯片 + Marp CLI 导出 | 易维护，但视觉平淡；**不作为主路径** |
| 2 **baoyu-slide-deck** | 图像幻灯片 → merge PPTX/PDF | **选用**；用户明确要求使用 baoyu-skills PPT skill |
| 3 reveal.js HTML | 网页演示 | 分享与维护成本高，不选 |

**选用理由：** 视觉质量适合对外宣讲；内置 `merge-to-pptx.ts` / `merge-to-pdf.ts`；outline + prompts 可版本管理、可单页 `--regenerate`。

**现场演讲适配：** `baoyu-slide-deck` 默认偏向自读分享。通过 `source.md` 声明 `live keynote` 模式、outline 极简 bullet、以及独立 `speaker-notes.md` 弥补口头展开需求。

---

## 4. 仓库结构

### 4.1 第一版宣讲稿（A）

```text
docs/presentations/apt-intro/
├── source.md              # 从 README 摘录的宣讲素材（baoyu Step 1 输入）
├── speaker-notes.md       # 现场口播稿（按页对应 outline，不进图像）
├── analysis.md            # baoyu 自动产出
├── outline.md             # baoyu Step 3 产出（含 STYLE_INSTRUCTIONS）
├── prompts/               # baoyu Step 5：每页图像 prompt
│   └── NN-slide-*.md
├── 01-slide-cover.png     # baoyu Step 7 产出（可选入库，见 §8）
├── ...
├── apt-intro.pptx         # merge-to-pptx.ts 合并
└── apt-intro.pdf          # merge-to-pdf.ts 合并
```

### 4.2 可复用模板（B）

```text
docs/presentations/_template/
├── source.template.md     # 章节骨架 + README 映射占位符
└── README.md              # 维护者手册：新建一场宣讲的步骤

templates/apt-deck.md      # Agent 指引：README → baoyu-slide-deck 全流程
```

### 4.3 内容 SSOT 链

```text
README.md（事实真源）
    ↓ 人工/Agent 摘录
source.md（宣讲叙事，约 1500–2500 字）
    ↓ baoyu-slide-deck
analysis.md → outline.md → prompts/ → PNG → apt-intro.pptx / .pdf
    ↓ 并行维护
speaker-notes.md（现场 15–20 分钟口播）
```

**原则：** 事实性内容以 `README.md` 为准；PPT 只摘录与重组；改 README 后按 checklist 同步 `source.md` 并重跑 deck，避免两套文档漂移。

---

## 5. 幻灯片大纲（15 页）

| # | 页型 | 页上内容（精简） | 口头展开（speaker-notes） |
|---|------|------------------|---------------------------|
| 1 | 封面 | APT 全称 + 一句话价值 | 自我介绍、场合 |
| 2 | 痛点 | 编造类型 / 不读架构 / 不登记契约 | 团队质量与可维护性（给 lead） |
| 3 | 转折 | Prompt 软约束 → MCP 硬约束 | 为什么 MCP 是关键 |
| 4 | 是什么 | 四层机制表格（缩略） | 30 秒讲清定位 |
| 5 | 架构图 | 四层 + 数据流示意图 | 不变层 vs 项目层（给架构师） |
| 6 | 工作流 | spec → plan → implement | 不讲细节，指向 README |
| 7 | MCP 亮点 | 13 工具分 3 组（契约/架构/设计） | 各举 1 个例子 |
| 8 | 命令一览 | 6 个命令（名称 + 一行） | 强调 `/feature` 与 `/plan-from-spec` |
| 9 | 多平台 | Claude / Cursor / Qoder / Codex | 一套 MCP，多端命令 |
| 10 | Before/After | 无 APT vs 有 APT 对比 | ROI 叙事（给 lead） |
| 11 | 案例叙事 | 功能从需求到闭环故事板 | 开发者共鸣（非 live demo） |
| 12 | 设计层 | Design 知识层一句话 | 有 UI 团队的额外价值 |
| 13 | 开始用 | 「详见 README」+ 仓库链接 | 不展开安装 |
| 14 | 状态与社区 | 试用中、欢迎 Star/Issue/PR | |
| 15 | 收尾 | Q&A / 仓库二维码或链接 | |

---

## 6. 生成工作流

维护者或 Agent 按以下顺序执行：

| 步骤 | 执行方 | 动作 |
|------|--------|------|
| 1 | Agent + `templates/apt-deck.md` | 从 `README.md` 生成/更新 `source.md` |
| 2 | `baoyu-slide-deck` | Setup & Analyze → `analysis.md` |
| 3 | `baoyu-slide-deck` | Step 2 确认：风格 / 受众 / 页数 / 是否审阅 outline（Round 1） |
| 4 | `baoyu-slide-deck` | 生成 `outline.md`（可先 `--outline-only` 审阅） |
| 5 | Agent | 根据 `outline.md` 编写 `speaker-notes.md` |
| 6 | `baoyu-slide-deck` | 生成 `prompts/` → 图像 → `merge-to-pptx` / `merge-to-pdf` |
| 7 | Git | 提交源文件与 `apt-intro.pptx`、`apt-intro.pdf` |

### 6.1 APT 默认 baoyu 参数

| 参数 | 值 | 理由 |
|------|-----|------|
| `--style` | `blueprint` | README 含 architecture/system 信号，适合技术宣讲 |
| `--audience` | `general` | 开发 + 技术负责人混合听众 |
| `--lang` | `zh` | 中文宣讲 |
| `--slides` | `15` | 15–20 分钟现场演讲 |

### 6.2 `source.md` 头部元数据（必填）

```markdown
---
presentation_mode: live-keynote
duration_minutes: 15-20
content_source: README.md
on_slide_max_bullets: 3
---
```

生成 outline 时遵守：叙事化标题、每页单一主旨、页上文字极简（细节放入 `speaker-notes.md`）。

---

## 7. `templates/apt-deck.md` 职责

该文件为 APT 仓库内 Agent 指引，**不**经 `agent-init` 分发到业务项目。须包含：

1. **前置条件**：本机已安装 `baoyu-slide-deck` 及可用图像后端（Cursor `GenerateImage`、Codex `imagegen` 等，按 baoyu 自动选择规则）
2. **README → source.md 映射表**：摘录章节与省略章节（安装、贡献指南不进 PPT）
3. **默认 baoyu 参数**（§6.1）
4. **现场演讲约束**（§6.2）
5. **同步 checklist**：README 哪些节变更时需更新 `source.md` 并重跑 deck
6. **单页修复**：`--regenerate N` 与 backup 规则引用 baoyu `modification-guide.md`

---

## 8. Git 提交策略

| 文件 | 提交 | 说明 |
|------|------|------|
| `source.md`、`outline.md`、`speaker-notes.md` | ✅ | 可 diff、可审阅 |
| `prompts/` | ✅ | 可复现、可单页重生成 |
| `apt-intro.pptx`、`apt-intro.pdf` | ✅ | 听众直接下载 |
| `*.png` | 可选 | 体积大；有 pptx 即可分享时可 `.gitignore` |
| `analysis.md` | 可选 | 生成日志 |

在 `docs/presentations/README.md`（或 `_template/README.md`）中说明：克隆仓库后可直接使用 `apt-intro.pptx`；维护者安装 baoyu-skills 后可从 `source.md` 再生成。

---

## 9. 工具链与依赖

| 组件 | 来源 | 用途 |
|------|------|------|
| `baoyu-slide-deck` | baoyu-skills（用户级 skill） | 大纲 → prompt → 图像 → PPTX/PDF |
| `scripts/merge-to-pptx.ts` | baoyu-slide-deck 内置 | PNG → `.pptx` |
| `scripts/merge-to-pdf.ts` | baoyu-slide-deck 内置 | PNG → `.pdf` |
| 图像后端 | 运行时原生或 baoyu-image-gen | 按 baoyu Confirmation Policy 与 backend 选择规则 |
| `templates/apt-deck.md` | APT 仓库 | 衔接 README 与 baoyu 流程 |

---

## 10. 现场演讲适配（baoyu 默认偏差修正）

| 问题 | 适配 |
|------|------|
| 页上文字过多 | `presentation_mode: live-keynote`；outline 每页 ≤3 bullet |
| 口头展开无处放 | `speaker-notes.md` 与 outline 页码一一对应 |
| 风格偏阅读型 | `blueprint` + balanced/minimal density；标题叙事化（baoyu content-rules） |
| 架构图 | `source.md` 内嵌结构描述，prompt 要求示意图/蓝图风格 |

---

## 11. 实现阶段任务清单（供 plan 引用）

1. 新增 `docs/presentations/_template/`（`source.template.md`、`README.md`）
2. 新增 `templates/apt-deck.md`
3. 从 `README.md` 撰写 `docs/presentations/apt-intro/source.md`
4. 运行 `baoyu-slide-deck` 生成 `outline.md` → 审阅 → `prompts/` → 图像 → PPTX/PDF
5. 编写 `speaker-notes.md`（15 页口播要点）
6. 在仓库根 `README.md` 增加「宣讲材料」小节，链接 `docs/presentations/apt-intro/apt-intro.pptx`
7. （可选）`docs/presentations/apt-intro/.gitignore` 排除 `*.png` 若体积过大

---

## 12. 验收标准

- [ ] `docs/presentations/apt-intro/apt-intro.pptx` 存在且约 15 页，可现场放映
- [ ] `apt-intro.pdf` 可作为异步附件分享
- [ ] `source.md` 与当前 `README.md` 核心主张一致，不含安装步骤细节
- [ ] `speaker-notes.md` 覆盖每页，总时长约 15–20 分钟
- [ ] `templates/apt-deck.md` 使未参与 brainstorming 的维护者可按文档再生成
- [ ] 根 `README.md` 可发现宣讲材料入口

---

## 13. 用户决策摘要（brainstorming）

- 用途：**A 宣讲**；B/C 交给 README
- 听众：**开发 + 技术负责人 + 混合叙事**
- 场景：**现场 15–20 分钟**
- 交付：**A 第一版 PPT + B 可复用流程**
- 生成工具：**baoyu-slide-deck**（用户明确要求）
