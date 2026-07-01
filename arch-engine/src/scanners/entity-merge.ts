import type { EntityDef, EntityGraph, EntityRelation } from "../types.js";

type EntityResult = { entities: EntityDef[]; relations: EntityRelation[] };

/**
 * Merge per-source entity scans into one graph.
 *
 * Entities are de-duplicated by the composite key `moduleSlug:table` (case
 * insensitive). When the same table shows up in multiple sources, fields are
 * unioned by name and the source added first wins field details, so callers
 * should pass JPA first, then MyBatis, then SQL (JPA > MyBatis > SQL detail
 * preference). The first source's moduleSlug / filePath / name are kept.
 *
 * Relations are de-duplicated by the (from, to, kind, source) tuple.
 */
export function mergeEntityGraphs(
  jpa: EntityResult,
  mybatis: EntityResult,
  sql: EntityResult
): EntityGraph {
  const entityMap = new Map<string, EntityDef>();

  const addEntity = (e: EntityDef): void => {
    const key = `${e.moduleSlug}:${e.table}`.toLowerCase();
    const existing = entityMap.get(key);
    if (!existing) {
      entityMap.set(key, { ...e, fields: [...e.fields] });
      return;
    }
    const seen = new Set(existing.fields.map((f) => f.name.toLowerCase()));
    for (const f of e.fields) {
      const lname = f.name.toLowerCase();
      if (!seen.has(lname)) {
        existing.fields.push(f);
        seen.add(lname);
      }
    }
    // keep first source's moduleSlug / filePath / name / source
  };

  for (const e of jpa.entities) addEntity(e);
  for (const e of mybatis.entities) addEntity(e);
  for (const e of sql.entities) addEntity(e);

  const relSet = new Set<string>();
  const relations: EntityRelation[] = [];
  for (const r of [...jpa.relations, ...mybatis.relations, ...sql.relations]) {
    const k = `${r.from}|${r.to}|${r.kind}|${r.source}`;
    if (relSet.has(k)) continue;
    relSet.add(k);
    relations.push(r);
  }

  return { entities: [...entityMap.values()], relations };
}
