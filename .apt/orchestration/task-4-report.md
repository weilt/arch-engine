# Task 4 Report — entity-md.ts + flow-md.ts writers

## Status
PASS

## Commit
`453e2c8` — `feat(writer): entity-md + flow-md writers with atomic write for v2.0.3`

## Files changed
- `arch-engine/src/writer/entity-md.ts` (new) — `writeEntityDocs`, renders `entities.md` + writes `entities.json`.
- `arch-engine/src/writer/flow-md.ts` (new) — `writeFlowDocs`, renders `flow.md` + writes `flow.json`.
- `arch-engine/src/writer/index.ts` (edit) — re-exports `writeEntityDocs`, `writeFlowDocs`.

## Implementation notes
- Both writers write to `getArchDir(projectRoot)` (`.ai/arch/`).
- Atomic write helper: mkdir → write `*.tmp` → `fs.rename` to final path. No `.tmp` artifacts left after run.
- `entities.md`: `# Entities` + per-entity `## {name}` field tables (Field / Type / Column / Nullable), then `## Relations` as `- {from} → {to} ({kind}) [source: {source}]`.
- `flow.md`: `# Data Flow` + edges grouped by source layer in canonical order (entity → repository → service → controller → api-client → route → store); each edge `- {from} → {to} (confidence: {confidence}) {label?}`. Edges whose `from` node is unknown fall back to the `to` node's layer; fully unresolved edges go under `## Other`.
- `.json` files use `JSON.stringify(graph, null, 2)`.

## Test summary
- `tsc --noEmit`: PASS (zero errors), baseline clean before and after.
- Build (`tsc` to dist): PASS.
- Runtime smoke test (throwaway script in OS temp, not committed): exercised both writers against sample graphs covering populated fields, an empty-fields entity, relations, multi-layer edges, labeled/unlabeled edges, and an orphan edge. Verified `entities.md`, `flow.md`, `entities.json` content and confirmed no `.tmp` files remain after atomic write. All output matched spec. Temp script removed after run.
- Scope kept to the 3 whitelisted files; unrelated working-tree changes (`docs/apt/plans/...`, `_write_spec.cjs`) left untouched.
