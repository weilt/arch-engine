# Task 6 — frontend-router extractor + scanPackageDir wiring

**Status:** PASS  
**Commit:** `7758b29`  
**Date:** 2026-06-28

## Verification (run by implementer)

| Check | Command | Result |
|-------|---------|--------|
| Unit tests | `npx vitest run tests/scanners/frontend-router.test.ts` | **PASS** — 14/14 (exit 0) |
| Type check | `node node_modules/typescript/bin/tsc --noEmit` | **PASS** — exit 0 (`TSC_EXIT=0`) |

## Commit contents

- `7758b29` — `feat(scanners): add frontend-router extractor + scanPackageDir wiring`
- 3 files changed, 598 insertions(+), 8 deletions(-)
  - `arch-engine/src/scanners/frontend-router.ts` (NEW, +401)
  - `arch-engine/src/scanners/frontend.ts` (edit, +25/-8)
  - `arch-engine/tests/scanners/frontend-router.test.ts` (NEW, +180)

Exactly the 3 whitelisted paths were staged. The only other dirty path in the
worktree (`.apt/orchestration/task-4-report.md`) is a pre-existing, unrelated
change and was **not** staged.

## Notes (as required by task brief)

1. **scanPackageDir return now includes routes.** Confirmed. Added
   `routes: RouteEntry[]` accumulator, an
   `if (isRouterFile(content)) routes.push(...extractRoutes(content));` block in
   the file loop, `routes.sort((a, b) => a.path.localeCompare(b.path))` next to
   `apiClients.sort(...)`, and `routes,` in the returned `FrontendPackage`. All
   mirroring the Task-5 `apiClients` pattern verbatim. `RouteEntry` and
   `FrontendPackage.routes?` already existed in `types.ts` (Task 1) and are
   imported, not re-declared.

2. **Path concatenation for nested children.** Each route's full path is
   `joinPath(parentPath, path)`. `joinPath` strips a trailing slash from the
   parent and leading slashes from the child, joins with a single `/`, then
   `normalizePath` collapses any `//` runs to `/` and strips a trailing `/`
   (except the root route `/`, preserved). So `/admin/` + `/users` ->
   `/admin/users`; a bare `/admin/` parent normalizes to `/admin`.
   Flatten correctness: nesting is walked one level per recursion frame.
   `findImmediateChildrenArrays` matches a `children: [...]` array only at
   brace-depth 0 inside the current object (its OWN children), skipping any
   `children:` nested in descendants; `emitObject` recurses into each child,
   which then finds its own children. A grandchild is emitted once
   (e.g. `/a/b/c`) and never re-attached to its grandparent (no `/a/c`).
   Output is a flat, fully-pathed `RouteEntry[]`; the `children?` field is left
   undefined on flattened entries (already expanded).

3. **Component value for `() => import(...)` arrow components.** For
   `component: () => import('@/views/Home.vue')` we store the import path
   `"@/views/Home.vue"` (readable + resolvable). For `component: UserList` we
   store the identifier `"UserList"`. Quoted component literals are unwrapped;
   anything else keeps the trimmed literal text.

## Coverage (14 tests, all green)

- vue-router 4 `createRouter` flat table (path/name/component)
- `() => import('...')` component path
- nested `children` flattened with concatenated paths
- double-slash normalization on join (`/admin/` + `/users`)
- deeply nested grandchildren (`/a/b/c`)
- `meta` scalar extraction (title/hidden, quoted/bool/number coercion)
- vue-router 3 `new VueRouter`
- React `<Route path=... element={<X/>}>`
- no-routes file -> `[]` (and `isRouterFile` false)
- empty `routes: []` table -> `[]`
