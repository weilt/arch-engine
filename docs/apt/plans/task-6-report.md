# Task 6 报告：页面工厂狗食测试

**Plan:** `docs/apt/plans/2026-07-03-apt-2.0.6-page-factory-plan.md` Task 6  
**Spec 依据:** §8 狗食 — fixture + 全 approved `_pages.md` + freeze 门禁集成

## 完成项

| 文件 | 变更 |
|------|------|
| `arch-engine/tests/dogfood/page-factory-freeze.test.ts` | 新增：临时目录复制 `v0-fixture/user-list` → `designs/v0/user-list`；写入全 approved `_pages.md`；`runDesignSync` + `queryDesign` 断言；`check-v0-freeze` CLI 烟测 |

## 测试覆盖

1. **design-sync 集成：** `runDesignSync(tmpRoot, { adapter: 'v0', source: 'designs/v0' })` 后 `queryDesign(page: user-list)` 返回 `logicMarkdown`（含 `listUsers`），`gaps` 不含 `manifest-not-approved`。
2. **freeze 门禁：** `node scripts/check-v0-freeze.mjs <tmpRoot>` exit 0（全 approved 布局）。

Fixture `designs/v0-fixture/user-list/page.manifest.json` 已为 `status: approved`，无需修改。

## 验证

```bash
cd arch-engine; npm test -- tests/dogfood/page-factory-freeze.test.ts
node --test scripts/check-v0-freeze.test.js
```

结果：**PASS**（page-factory-freeze 2/2；check-v0-freeze 5/5）

## 状态

**DONE**
