# Task 7 报告：discoverAutoPathRules + WebProperties 直连

**Plan:** `docs/apt/plans/2026-07-04-java-api-path-rules-plan.md` Task 7  
**Spec 依据:** §6 扩展自动发现 — 探测器 A/B；§5.1 `resolveJavaPathRules` roots 合并

## 完成项

| 文件 | 变更 |
|------|------|
| `arch-engine/src/scanners/java-path-rules.ts` | `discoverAutoPathRulesFromRoot` → `discoverAutoPathRules(roots: string[])`，多 root glob `**/*.java` |
| 同上 | 探测器 A：`WebMvcRegistrations` → `WebProperties` 链（保留） |
| 同上 | 探测器 B：`@ConfigurationProperties` + `new Api(` 直连，无需同文件含 `WebMvcRegistrations` |
| 同上 | `mergeRulesByPattern` 按 `controllerPattern` 去重，B 不覆盖 A 已命中 pattern |
| 同上 | `resolveJavaPathRules`：`roots = [projectRoot, ...extraSourceRoots.map(resolve)]` |
| `arch-engine/tests/scanners/java-path-rules.test.ts` | 新增 WebProperties-only fixture 单测（仓库无 `WebMvcRegistrations` 字符串） |

## 验证

```powershell
cd arch-engine; npm test -- tests/scanners/java-path-rules.test.ts
```

结果：**8/8 PASS**

## 后续（Task 8–9）

- Task 8：探测器 C `WebMvcConfigurer`
- Task 9：`AutoConfiguration.imports` 链 + `extraSourceRoots` fixture 集成

## 状态

**DONE**
