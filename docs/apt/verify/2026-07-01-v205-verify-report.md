# Verify Report

**Plan:** `docs/apt/plans/2026-06-30-call-graph-impact-plan.md`
**Overall:** FAIL
**Date:** 2026-07-01

## Summary

- Plan 对照 — PASS (7/7 tasks implemented, all files present, all verify commands pass)
- 架构 audit — FAIL (21 unregistered, 1 modified; knowledge base not synced with new source files)
- 设计 audit — SKIP (no UI in v2.0.5)
- 契约登记 — PASS (CallGraph + OntologyTopology both registered, query_contract returns full TS content)
- 可检索性 — PASS (search_arch returns relevant results; new scanner files will surface after finish-feature registration)
- 测试/构建 — PASS (arch-engine 290 + mcp-server 127 = 417 tests; tsc clean both packages)

## Plan Coverage

- Task 1: CallGraph types (types.ts + index.ts) — PASS — commit 4aee55e
- Task 2: call-graph-java scanner — PASS — commit 424b30d (6 test assertions)
- Task 3: call-graph-frontend scanner — PASS — commit 94b2adb (5 test assertions)
- Task 4: Registry + Pipeline + Writer — PASS — commit 51d7769 (registry.test updated, tsc clean)
- Task 5: refresh_asset TS bug fix — PASS — commit eb0454a (8 test assertions including lowercase TS files)
- Task 6: query_impact extension — PASS — commit e9219ff (5 new + 6 existing tests pass, no regression)
- Task 7: query_ontology topology + drill — PASS — commit 1f4f6b7 (10 topology + topic-drill tests)

## Failures

- [F1] 架构 audit: 21 unregistered files (new v2.0.5 source: call-graph-java.ts, call-graph-frontend.ts, call-graph.ts, test fixtures, etc.) + 1 modified. Knowledge base (.ai/arch/) not synced with new source since last-scan anchor bf3a5fe (v2.0.4). Requires `/apt-finish-feature` to refresh/register assets.

## Recommended next steps

- FAIL → run `/apt-finish-feature` to sync architecture knowledge (refresh modified assets, register new source files)
- After finish-feature → re-run `/apt-verify` to confirm PASS
- GitHub push still pending (10 commits, network was reset during v2.0.5 implementation)
