import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type {
  EntityDef,
  EntityField,
  EntityRelation,
  EntityRelationKind,
  JavaModule,
} from "../types.js";

const CLASS_RE = /public\s+(?:abstract\s+)?class\s+(\w+)/;
const TABLE_RE = /@Table\s*\(\s*(?:name\s*=\s*)?["']([^"']+)["']/i;

// One or more @annotations (each with optional `(...)` args) followed by a
// field declaration `modifiers Type name ;` / `= ...`. Method declarations are
// excluded because they end in `(` rather than `;` / `=`.
const ANNOTATED_FIELD_RE =
  /((?:@[A-Za-z_][\w.]*\s*(?:\([^)]*\))?\s*)+?)(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:final\s+)?([A-Za-z_][\w.<>,\[\]\s]*?)\s+([A-Za-z_]\w*)\s*[;=]/g;

const RELATION_KINDS: { ann: string; kind: EntityRelationKind }[] = [
  { ann: "OneToMany", kind: "one-to-many" },
  { ann: "ManyToOne", kind: "many-to-one" },
  { ann: "OneToOne", kind: "one-to-one" },
  { ann: "ManyToMany", kind: "many-to-many" },
];

/** Collapse a raw field type to its simple class name (List<OrderDO> -> OrderDO). */
export function simpleTypeName(rawType: string): string {
  const t = rawType.trim();
  const generic = t.match(/<\s*([A-Za-z_]\w*)\s*>/);
  if (generic) return generic[1];
  return t.replace(/[\[\]]/g, "").trim();
}

function hasAnnotation(annBlock: string, name: string): boolean {
  return new RegExp(`@${name}\\b`).test(annBlock);
}

/**
 * Extract a single file's JPA entity + relations using the original regex
 * approach. Shared by {@link scanJpaEntitiesRegex} and the AST scanner's
 * per-file fallback so both paths produce identical output. Returns
 * `{ entity: null }` when the file is not a `@Entity` (or no class matches).
 */
export function extractJpaEntityRegex(
  content: string,
  moduleSlug: string,
  filePath: string
): { entity: EntityDef | null; relations: EntityRelation[] } {
  if (!/@Entity\b/.test(content)) return { entity: null, relations: [] };

  const classMatch = content.match(CLASS_RE);
  if (!classMatch) return { entity: null, relations: [] };
  const className = classMatch[1];

  const tableMatch = content.match(TABLE_RE);
  const table = tableMatch ? tableMatch[1] : className;

  const fields: EntityField[] = [];
  const relations: EntityRelation[] = [];

  for (const m of content.matchAll(ANNOTATED_FIELD_RE)) {
    const annBlock = m[1];
    const fieldType = m[2].trim();
    const fieldName = m[3];

    let matchedRelation = false;
    for (const { ann, kind } of RELATION_KINDS) {
      if (hasAnnotation(annBlock, ann)) {
        relations.push({
          from: className,
          to: simpleTypeName(fieldType),
          kind,
          field: fieldName,
          source: "jpa",
        });
        matchedRelation = true;
      }
    }
    if (matchedRelation) continue;

    if (hasAnnotation(annBlock, "Column")) {
      const colArgs =
        annBlock.match(/@Column\s*(?:\(([^)]*)\))?/i)?.[1] ?? "";
      const nameAttr = colArgs.match(/name\s*=\s*["']([^"']+)["']/i);
      const nullableAttr = colArgs.match(/nullable\s*=\s*(true|false)/i);
      fields.push({
        name: fieldName,
        type: simpleTypeName(fieldType),
        column: nameAttr ? nameAttr[1] : fieldName,
        // JPA @Column defaults to nullable when the attribute is absent.
        nullable: nullableAttr ? nullableAttr[1] === "true" : true,
      });
    }
  }

  const entity: EntityDef = {
    name: className,
    table,
    moduleSlug,
    filePath,
    fields,
    source: "jpa",
  };
  return { entity, relations };
}

export async function scanJpaEntitiesRegex(
  projectRoot: string,
  modules: JavaModule[]
): Promise<{ entities: EntityDef[]; relations: EntityRelation[] }> {
  const entities: EntityDef[] = [];
  const relations: EntityRelation[] = [];

  for (const module of modules) {
    const moduleDir = path.join(projectRoot, module.path);
    const javaFiles = await fg.glob("**/*.java", {
      cwd: moduleDir,
      absolute: true,
      ignore: ["**/target/**"],
    });

    for (const absFile of javaFiles) {
      const content = await fs.readFile(absFile, "utf-8");
      const filePath = path
        .relative(projectRoot, absFile)
        .replace(/\\/g, "/");
      const { entity, relations: rels } = extractJpaEntityRegex(
        content,
        module.slug,
        filePath
      );
      if (entity) {
        entities.push(entity);
        relations.push(...rels);
      }
    }
  }

  return { entities, relations };
}
