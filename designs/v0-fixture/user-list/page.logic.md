# 用户列表

## 操作明细

| 操作 | 触发 | 结果 |
|------|------|------|
| 搜索 | 输入关键词 + 回车 | 表格按姓名/邮箱过滤 |
| 新建 | 点击「新建用户」 | 跳转 `/users/new` |
| 编辑 | 行内「编辑」 | 跳转 `/users/:id/edit` |
| 删除 | 行内「删除」+ 确认 | 调用 `deleteUser`，刷新列表 |

## 主流程

1. 进入页面加载 `listUsers({ page, pageSize, q })`
2. 展示表格；无数据时显示 EmptyState
3. 分页切换重新请求

## 状态

- `loading`：SkeletonList
- `empty`：EmptyState
- `error`：Alert + 重试

## 依赖

- `listUsers`
- `deleteUser`
- PageHeader、EmptyState、PrimaryButton
