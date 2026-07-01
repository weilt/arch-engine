# v0 视觉伴侣 Prompt（按页生成 Handoff 草稿）

将本模板与页面素材一并交给 Codex / 其它视觉模型。**只写** `designs/v0/<page-id>/` 下文件，**不要**写 `src/` 业务代码。

## 输入

- `preview.html` 和/或 `page.tsx`（v0 导出）
- 可选：v0 分享链接、PM 口头说明

## 输出（仅此目录）

```
designs/v0/<page-id>/
  page.manifest.json   # 必填
  page.logic.md        # 必填
```

`status` 一律 **`draft`**，待 PM 审阅后改为 `approved`。

## `page.manifest.json` 字段

| 字段 | 说明 |
|------|------|
| `id` | kebab-case，与目录名一致 |
| `pageType` | `list` \| `form` \| `detail` \| `dashboard` \| `auth` \| `settings` \| `wizard` \| `custom` |
| `feature` | 功能域 slug，如 `user-management` |
| `title` | 中文页面标题 |
| `route` | 前端路由，如 `/users` |
| `description` | 一句话说明页面用途 |
| `v0Url` | 可选，v0 原型链接 |
| `status` | 固定 `draft` |

不确定的字段写 **`TBD`**，并在 `page.logic.md` 末尾「待 PM 确认」列出。

## `page.logic.md` 结构

```markdown
# <页面标题>

## 操作明细
| 操作 | 触发 | 结果 |
|------|------|------|

## 主流程
1. …

## 状态
- loading / empty / error …

## 依赖
- API 函数名、语义组件 id（PageHeader、EmptyState 等）
```

从视觉稿推断：

- **列表页**（表格、分页）→ `pageType: list`
- **表单页**（输入框、提交）→ `pageType: form`
- 标注 `data-component` 对应的语义组件 id（与项目 `query_design(scope: global)` 一致）

## 禁止

- 不要生成或修改 `src/` 下生产代码
- 不要臆造已不存在的 API；未知接口写 `TBD` 并备注
- 不要直接将 `status` 设为 `approved`（PM 职责）

## PM 审阅后

1. 修正 manifest / logic，设 `status: approved`，填 `reviewedBy`、`reviewedAt`
2. 将 v0 导出的 `page.tsx`（及可选 `preview.html`）放入同目录
3. 项目根执行：`design-sync --adapter v0 --source designs/v0/<page-id>`
4. 开发前 Agent 执行：`query_design(page: <page-id>)`；`gaps` 含 `manifest-not-approved` 时须 `report_design_gap`
