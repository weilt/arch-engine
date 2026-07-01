import type { EntityDef, EntityRelation, JavaModule } from "../types.js";
import { scanJpaEntitiesRegex } from "./entity-jpa-regex.js";

type EntityResult = { entities: EntityDef[]; relations: EntityRelation[] };

/**
 * JPA entity scanner dispatcher.
 *
 * Prefers the AST scanner (`java-parser`): it parses each `@Entity` file's CST
 * and, per file, falls back to the regex extractor when that file cannot be
 * parsed, so one bad file never degrades the rest. If the AST module itself
 * cannot be loaded (e.g. `java-parser` is not installed) or the AST scan fails
 * outright, this degrades to a full regex scan.
 *
 * Availability is probed with a dynamic import rather than `require.resolve`
 * because this package ships as native ESM (`"type": "module"`).
 */
export async function scanJpaEntities(
  projectRoot: string,
  modules: JavaModule[]
): Promise<EntityResult> {
  try {
    const { scanJpaEntitiesAst } = await import("./entity-jpa-ast.js");
    return await scanJpaEntitiesAst(projectRoot, modules);
  } catch {
    return scanJpaEntitiesRegex(projectRoot, modules);
  }
}
