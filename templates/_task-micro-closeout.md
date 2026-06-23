测试通过后、handoff 之前，对本 Task 范围内执行 **APT 微闭环**（禁止调用 `audit_arch_changes`）：

## 1. TS 契约（本 Task 新增对外类型时）

1. 确保契约定义文件存在且类型严格。
2. 每个新对外可调用类型调用 **`register_contract`**（`name`, `description`, `tsFilePath`）。

## 2. 架构资产（本 Task 改动的已索引路径）

1. 对 **Files 白名单** 内、且属于架构索引的 **`modified` / `new` / `unregistered`** 路径 → **`refresh_asset`**（`sourcePath` 必填）。
2. 对 **Files 白名单** 内删除的已索引路径 → **`remove_asset`**（`assetId` 或 `sourcePath`）。
3. 若无架构资产变更：在 report 中写明「本 Task 无架构资产变更」。

## 3. 写入 report

在 `task-N-report.md` 的 **APT Micro-closeout** 小节列出：`ContractsRegistered`、`AssetsRefreshed`、`AssetsRemoved`。
