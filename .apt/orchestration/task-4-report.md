# Task 4 Report — runReindexApis core

**Plan:** `docs/apt/plans/2026-07-04-java-api-path-rules-plan.md`  
**Status:** complete  
**Verify:** `cd arch-engine && npm test -- tests/reindex/apis.test.ts` — PASS (2 tests)

## Delivered

| File | Change |
|------|--------|
| `arch-engine/src/reindex/apis.ts` | **NEW** — `runReindexApis`, `ReindexApisReport`, `ReindexApisDeps` |
| `arch-engine/src/writer/markdown.ts` | Export `renderApiMd`, add `writeApiDocsForModel` |
| `arch-engine/src/writer/arch-index.ts` | Add `patchArchIndexApiNodes` |
| `arch-engine/src/vector/sqlite-store.ts` | Add `deleteChunksByKindAndPathPrefix` |
| `arch-engine/src/pipeline.ts` | Re-export `runReindexApis` types |
| `arch-engine/src/index.ts` | Re-export `runReindexApis` types |
| `arch-engine/tests/reindex/apis.test.ts` | **NEW** — java-module fixture + manual `/admin-api` → reindex → `api.md` |

## Behavior

`runReindexApis(projectRoot, deps?)`:

1. `loadOrInitConfig` + `resolveApiKey` (embedding)
2. `resolveJavaPathRules` + `writePathRulesSnapshot`
3. Maven scan → `scanJavaSources` → `scanOpenApiGlobs` → `mergeDocumentModel`
4. `writeApiDocsForModel` per backend module with APIs
5. `loadArchIndex` → `patchArchIndexApiNodes` → `writeArchIndex` + `writeIndexMd`
6. VectorStore: `deleteChunksByKindAndPathPrefix('api', 'backend/<slug>/api')` per module; embed + upsert API chunks; patch index chunk refs
7. If `.ai/arch/entities.json` exists → `deriveFlowGraph` → `writeFlowDocs`
8. Update `last-scan.json` `pathRulesHash` (preserve other fields)

Returns `{ apiCount, modulesUpdated }`.

## Notes

- Avoided circular import with `pipeline.ts` by inlining `computePathRulesHash` in `apis.ts` (same algorithm as `pipeline.ts`).
- Integration test uses dynamic module slug from `findMavenModules` (fixture copied to temp root, not `java-module` subfolder).
