# Verify Report

**Plan:** docs/apt/plans/2026-07-02-v210-workspace-multilang-plan.md
**Overall:** FAIL
**Date:** 2026-07-02

## Summary
| 维度 | 结果 |
|------|------|
| Plan 对照 | PASS |
| 架构 audit | FAIL |
| 设计 audit | SKIP |
| 契约登记 | FAIL |
| 可检索性 | FAIL |
| 测试/构建 | PASS |

## Plan Coverage

| Task | Result | 备注 |
|------|--------|------|
| 1 types.ts | PASS | Workspace/Go/Python interfaces + repoSlug + LastScanState.repos (commit 65622e6) |
| 2 proto-scanner.ts | PASS | 4 tests, shared .proto parser (commit 2150344) |
| 3 workspace.ts | PASS | 15 tests, loadWorkspace/initWorkspace/slugFromRepoPath (commit 56a42e9) |
| 4 go-scanner.ts | PASS | 5 tests, gin/echo/chi/net-http + gRPC + struct + call graph (commit 713a5ae) |
| 5 python-scanner.ts | PASS | 5 tests, FastAPI/Flask/Django/Tornado + ORM + indent-aware call graph (commit 6da94b0) |
| 6 java.ts + frontend.ts | PASS | repoSlug threaded, 365 tests backward compat (commit c584a5d) |
| 7 registry.ts | PASS | Go/Python scanner registration + repoLang routing, 8 plugins, 365 tests (commit a21b1e1) |
| 8 paths.ts + config.ts | PASS | getArchBackendRepoDir + validateWorkspaceConfig, 365 tests (commit 5a3c7da) |
| 9 pipeline.ts | PASS | workspace-aware multi-root, 3 tests (Java+Go+Python merge), 368 total (commit 4b1bea1) |
| 10 index.ts | PASS | all new types/scanners exported, tsc clean both packages (commit 036aa11) |
| 11 mcp ontology | PASS | repoCount + repo grouping, 4 tests, 140 total (commit a691cf8) |
| 12 mcp impact | PASS | crossRepoEdges detection, 4 tests, 140 total (commit eab9ca6) |
| 13 full verification | PASS | arch 368/368 + mcp 140/140, tsc clean |

## Failures

- [F1] 架构 audit FAIL: .ai/arch last-scan at commit 77c273f (17 commits behind HEAD). New v2.1.0 files (workspace.ts, go-scanner.ts, python-scanner.ts, proto-scanner.ts, and modified types.ts/registry.ts/pipeline.ts) are not yet arch-indexed. Requires /finish-feature or sync-changes to sync knowledge base.
- [F2] 契约登记 FAIL: WorkspaceConfig, scanGoSources, scanPythonSources, scanProtoServices — new exported types/functions not registered as contracts via register_contract.
- [F3] 可检索性 FAIL: search_arch for workspace/go/python scanners returns no hits (not yet indexed in .ai/arch).

## Recommended next steps

- FAIL -> /finish-feature: run audit_arch_changes + refresh_asset for all new/modified files + register_contract for new exported types, then re-run /verify to confirm PASS.
