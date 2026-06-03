你现在已经完成了核心代码，必须执行闭环注册！

## 闭环注册（必须）

### 1. TS 契约（若有对外 TS 类型）

1. 检查你是否新建了可供外部调用的接口、类或函数。
2. 确保新接口在 `src/contracts/` 或对应目录下有严格的 TypeScript 类型定义文件。
3. 对于每一个新的 TS 契约，**必须调用 MCP 工具 `register_contract`**，传入 `name`、`description`、`tsFilePath`。

### 2. 架构资产（若有新建/显著修改的可复用能力）

以下任一项必须调用 **`register_asset`**（与 `register_contract` 双轨并行，互不替代）：

- 新组件、工具类、枚举
- 新 Feign / CommonApi、对外 REST 接口
- 新 starter 模块或 UI 基础包导出
- 新 POJO / DTO 作为跨模块共享模型

示例调用：

```json
{
  "kind": "util",
  "name": "JsonUtils",
  "module": "base-common",
  "sourcePath": "base-common/src/main/java/.../JsonUtils.java",
  "summary": "JSON 序列化与反序列化工具",
  "whenToUse": "需要在模块间统一 JSON 处理时",
  "howToUse": "直接调用静态方法 parse / stringify",
  "exports": ["parse", "stringify"],
  "tags": ["json", "util"]
}
```

`kind` 可选：`component` | `util` | `enum` | `starter` | `api` | `rpc` | `pojo`。

### 3. 验证

- 对每个 `register_contract`：确认 `.ai/INDEX.md` 已更新。
- 对每个 `register_asset`：用自然语言调用 `search_arch`，确认 top 结果含刚注册的 `assetId` 与 `sourcePath`。
- 需要精读文档时，用 `query_arch` 访问返回的 `path`（可加 `#锚点`）。

注册成功后，输出结构化完成报告（列出已注册的契约与架构资产）。
