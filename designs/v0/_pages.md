# v0 页面冻结进度

开发维护的 SSOT。Phase B（`plan-from-spec`）开始前，**每一行** `approved` 须为 `yes`。

| page-id | title | handoff | approved | synced | notes |
|---------|-------|---------|----------|--------|-------|
| user-list | 用户列表 | pending | no | no | fixture 见 `designs/v0-fixture/user-list/`；待开发 handoff |

**列说明**

| 列 | 含义 |
|----|------|
| `page-id` | kebab-case，与 `page.manifest.json` 的 `id` 一致 |
| `title` | 中文标题 |
| `handoff` | `pending` \| `wip` \| `done` — 双文件是否写完 |
| `approved` | `no` \| `yes` — 开发认定已按 PM 设计说清楚 |
| `synced` | `no` \| `yes` — 是否已 `design-sync --adapter v0` |
| `notes` | 待对文档、权限等待办 |
