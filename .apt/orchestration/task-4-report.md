# Task 4 Report — P0-2 + P1 + P2 baseline fixes

**Status:** DONE (green + tsc 0)
**Commit SHA:** `31ba18d81168a6b911835c6652f69f4640b4c0ab`
**Date:** 2026-06-28

## Verification

| Check | Command | Result |
-------|---------|--------|
| vitest (new files) | `npx vitest run tests/scanners/frontend.test.ts tests/pipeline.test.ts` | `Test Files 2 passed (2)`, `Tests 10 passed (10)` |
| tsc | `node node_modules/typescript/bin/tsc --noEmit` | exit code **0** |

## git show --stat

```
commit 31ba18d81168a6b911835c6652f69f4640b4c0ab
    feat(scanners): extend source globs + non-JS-root discovery + new-package incremental

 arch-engine/src/pipeline.ts                 |  67 +++++++++++++++--
 arch-engine/src/scanners/frontend.ts        |  53 +++++++++++++-
 arch-engine/tests/pipeline.test.ts          |  27 +++++++
 arch-engine/tests/scanners/frontend.test.ts | 109 +++++++++++++++++++++++++++-
 4 files changed, 246 insertions(+), 10 deletions(-)
```

Staged exactly the 4 whitelisted paths; no unrelated dirty-worktree changes were
included (`git diff --cached --name-only` confirmed the 4 files before commit).

## Changes by item

### P0-2 — SOURCE_GLOBS (`frontend.ts`)
`SOURCE_GLOBS` extended to `["src/**/*.{ts,tsx,js,jsx,mjs,vue}"]`. `collectSourceFiles`
now picks up plain `.js/.jsx/.mjs`. Note: `.js/.jsx/.mjs` classify as `util` (only
`.tsx`/`.vue` are component files per `ts-export.ts isComponentFile`), which the
tests assert via the collected file paths.

### P2-a — config.frontendPackages priority (`pipeline.ts`)
**Yes, config is passed into `resolveFrontendPackageDirs`.** Added a second param
`frontendPackages?: string[]` and the call site now passes
`config.frontendPackages`. When non-empty, each entry is resolved (absolute OR
relative to projectRoot), validated for a `package.json` with a `name`, slugified,
and returned in the dirs map, bypassing workspace probing entirely. A new local
helper `slugFromPkgName` de-duplicates the slug logic between the config branch and
the existing workspace branch. Logged via `archLog.info` so it is not a silent
success. When empty/absent, falls through to the original workspace logic unchanged.

### P2-b — non-JS-root auto-discovery (`frontend.ts`)
**Hooked in `scanFrontend`'s empty-pattern branch**, not `getWorkspacePatterns`.
Rationale: `getWorkspacePatterns` is a pure workspace probe; the empty-pattern
branch is the natural trigger point and already has `projectRoot` plus the
`scanPackageDir` reuse. A new module-private helper `discoverChildFrontendPackages`
scans the root's direct child dirs (skipping `node_modules` and dot-dirs) for any
with a `package.json` that has frontend deps (reuses `inferFramework`). Discovered
packages are logged via `archLog.info`; when nothing is discoverable it logs an
`archLog.warn` so the empty result is never silent.

### P1 — new-package / new-module incremental detection (`pipeline.ts`)
In the incremental branch, after `mapFilesToPackages`, newly-added units present
now but absent from `previousScan` are pulled into the affected sets:
packages via `packageDirs.keys()` vs `previousScan.packages`, and backend modules
via `model.modules` slugs vs `previousScan.modules`. **Extracted a pure helper**
`detectNewUnits(currentSlugs, previousSlugs): Set<string>` (exported from
`pipeline.ts`) which is unit-tested directly in `tests/pipeline.test.ts`, then
wired into the incremental block. A `newPackages`/`newModules` count is added to
the existing `start-init: incremental mode` log line.

## Notes

- `mapFilesToPackages` signature in `git-diff.ts` was NOT changed (per plan);
  the new-package detection lives entirely in `pipeline.ts`.
- `frontendPackages` field already existed on `ArchConfig` + `DEFAULT_CONFIG`
  (Task 2); this task only adds the consumer.
- All new code is ASCII; `.js` specifiers used for relative imports (Node16 ESM).
- `let entries;` (untyped) inside try/catch matches the existing pattern in
  `design/audit.ts`; it is allowed under `strict` and avoids a brittle cross
  `@types/node`-version `Dirent` annotation.
