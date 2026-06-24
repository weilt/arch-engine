# Task 6 Report: register_ui_pattern MCP

**Plan:** `docs/apt/plans/2026-06-24-design-knowledge-layer-completion-plan.md`  
**Status:** completed  
**Date:** 2026-06-24

## 交付物

| 文件 | 说明 |
|------|------|
| `arch-engine/src/design/implementations.ts` | 读写 `.ai/design/implementations/<page-slug>.json` |
| `arch-engine/src/design/paths.ts` | 新增 `getDesignImplementationsDir` |
| `arch-engine/src/design/types.ts` | `UiPatternImplementation`、`RegisterUiPatternInput/Result` |
| `arch-engine/src/index.ts` | 导出 implementations API |
| `arch-engine/tests/design/implementations.test.ts` | 存储层单测（8 项） |
| `mcp-server/src/design-register.ts` | MCP handler |
| `mcp-server/src/index.ts` | 注册第 14 个 APT 工具 `register_ui_pattern` |
| `mcp-server/tests/design-register.test.ts` | handler 单测（3 项） |

## Schema

写入 `.ai/design/implementations/<page-slug>.json`：

```json
{
  "page": "user-settings",
  "sourcePath": "src/pages/UserSettings.vue",
  "componentsUsed": ["PrimaryButton", "Card"],
  "notes": "optional",
  "registeredAt": "2026-06-24T..."
}
```

## MCP 工具

**`register_ui_pattern`** — finish-feature 闭环：将设计页面配方 slug 映射到实现源码路径与所用语义组件。

参数：`page`、`sourcePath`、`componentsUsed`（必填）、`notes`（可选）。

## 验证

```bash
cd arch-engine && npm test -- tests/design/implementations.test.ts
```

结果：**8 tests passed**

```bash
cd mcp-server && npm test -- tests/design-register.test.ts
```

结果：**3 tests passed**

## 提交

```
feat(design): add register_ui_pattern MCP tool
```
