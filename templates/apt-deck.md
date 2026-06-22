---
description: 从 README 生成 APT 宣讲幻灯片（baoyu-slide-deck）
---

你是 APT 仓库维护者，即将为对外宣讲生成幻灯片。严格按以下步骤执行。

## 前置条件

- 本机已安装 `baoyu-slide-deck`（baoyu-skills）
- 图像后端可用（Cursor `GenerateImage` / Codex `imagegen` 等，按 baoyu 规则自动选择）
- `bun` 可用于 merge 脚本

## 默认参数

| 参数 | 值 |
|------|-----|
| `--style` | `blueprint` |
| `--audience` | `general` |
| `--lang` | `zh` |
| `--slides` | `15` |
| 输出目录 | `docs/presentations/apt-intro/` |

## Step 1：生成 source.md

从仓库根 `README.md` 摘录宣讲素材，写入 `docs/presentations/apt-intro/source.md`。

**必须包含头部元数据：**

```yaml
---
presentation_mode: live-keynote
duration_minutes: 15-20
content_source: README.md
on_slide_max_bullets: 3
---
```

### README → source.md 映射

| README 章节 | 是否摘录 | 用途 |
|-------------|----------|------|
| 首段 + tagline | ✅ | 封面、转折 |
| 这是什么 / 四层机制 | ✅ | 定位、架构 |
| 命令与工具一览 | ✅ 缩略 | 命令页、MCP 页 |
| 第三阶段工作流 | ✅ | 工作流页 |
| 核心能力（契约/架构/设计） | ✅ 各 1-2 句 | 案例、设计层 |
| 工作原理 mermaid | ✅ 文字化 | 架构图页 |
| 多平台表格 | ✅ | 多平台页 |
| 快速开始 / 安装 | ❌ | 留给 README |
| 贡献指南 | ❌ | 留给 README |

目标字数：1500–2500 字。每页 slide 信息极简（≤3 bullet）。

## Step 2：运行 baoyu-slide-deck

1. 将 `source.md` 作为输入，执行 baoyu-slide-deck 全流程
2. 用户已批准 spec 时可用默认参数直接生成（等效「按默认出幻灯片」）
3. 产出：`analysis.md` → `outline.md` → `prompts/` → PNG → `apt-intro.pptx` / `.pdf`

## Step 3：编写 speaker-notes.md

根据 `outline.md` 每页编写 1–2 分钟口播要点。总时长 15–20 分钟。细节放备注，不进图像。

## Step 4：合并与提交

```bash
cd docs/presentations/apt-intro
bun install          # 首次：安装 pptxgenjs + pdf-lib
bun merge-deck.mjs .   # 生成 apt-intro.pptx / apt-intro.pdf
```

（备选：若 baoyu 目录已安装 merge 依赖，可用 `merge-to-pptx.ts` / `merge-to-pdf.ts`。）

提交：`source.md`、`outline.md`、`speaker-notes.md`、`prompts/`、`apt-intro.pptx`、`apt-intro.pdf`

## 同步 checklist

README 以下节变更 → 更新 source.md → 重跑 deck：

- 价值主张 / tagline
- 四层机制表
- 6 命令 / 13 MCP 工具
- 工作流（plan-from-spec / implement-plan）
- 支持平台列表

## 单页修复

编辑 `prompts/NN-slide-*.md` → `baoyu-slide-deck --regenerate N` → 重新 merge。详见 baoyu `references/modification-guide.md`。
