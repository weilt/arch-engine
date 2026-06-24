# 宣讲幻灯片维护手册

APT 宣讲材料使用 **baoyu-slide-deck** 从 `README.md` 生成图像型幻灯片，合并为 PPTX/PDF。

## 听众直接使用

克隆仓库后可直接打开：

- [apt-intro.pptx](../apt-intro/apt-intro.pptx)
- [apt-intro.pdf](../apt-intro/apt-intro.pdf)
- 现场演讲口播：[speaker-notes.md](../apt-intro/speaker-notes.md)

## 维护者再生成

### 前置条件

1. 本机已安装 [baoyu-skills](https://github.com/JimLiu/baoyu-skills) 中的 `baoyu-slide-deck`
2. 可用图像后端（Cursor `GenerateImage`、Codex `imagegen` 等）
3. `bun` 或 `npx -y bun`（用于 merge 脚本）

### 新建一场宣讲

1. 复制 `source.template.md` 到 `docs/presentations/{topic-slug}/source.md`
2. 按模板从 `README.md` 摘录内容（**不要**复制安装步骤、贡献指南）
3. 按仓库根 `templates/apt-deck.md` 指引运行 baoyu-slide-deck
4. 编写 `speaker-notes.md`（现场口播，不进图像）
5. 提交 `source.md`、`outline.md`、`prompts/`、`*.pptx`、`*.pdf`

### 更新已有宣讲

当 `README.md` 以下章节变更时，需同步 `source.md` 并重跑 deck：

- 首段价值主张 / tagline
- 「这是什么」四层机制
- 命令与 MCP 工具一览
- 第三阶段工作流
- 多平台支持列表
- 核心能力（契约 / 架构 / 设计）

**文字可先于图像更新：** 可先提交 `source.md`、`speaker-notes.md`、`outline.md`、`prompts/` 与 README 对齐，并在 README / `docs/presentations/README.md` 标注 pptx/pdf 图像滞后；待维护者重跑 baoyu-slide-deck 后再移除标注。

### 单页修复

```bash
# 编辑 prompts/NN-slide-*.md 后，用 baoyu-slide-deck --regenerate N 重生成 PNG
cd docs/presentations/apt-intro
bun install   # 首次
bun merge-deck.mjs .
```

若本机 baoyu merge 脚本依赖齐全，也可：

```bash
bun ~/.claude/skills/baoyu-slide-deck/scripts/merge-to-pptx.ts docs/presentations/apt-intro
bun ~/.claude/skills/baoyu-slide-deck/scripts/merge-to-pdf.ts docs/presentations/apt-intro
```

### PNG 入库策略

默认将 `*.png` 加入 `.gitignore`（有 pptx 即可分享）。若需完整可复现，可移除 gitignore 并提交 PNG。
