import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type {
  EntityDef,
  EntityField,
  EntityRelation,
  JavaModule,
} from "../types.js";

// <resultMap ...> ... </resultMap> — capture opening attrs and inner body.
const RESULTMAP_RE = /<resultMap\b([^>]*)>([\s\S]*?)<\/resultMap>/gi;
const RESULT_RE = /<result\b([^>]*?)\/?>/gi;
// Self-closing `<assoc .../>` or paired `<assoc ...> ... </assoc>`.
const ASSOC_RE = /<association\b([^>]*?)(?:\/>|>(?:[\s\S]*?<\/association>)?)/gi;
const COLLECTION_RE =
  /<collection\b([^>]*?)(?:\/>|>(?:[\s\S]*?<\/collection>)?)/gi;

function simpleName(t: string): string {
  const cleaned = t.replace(/[<>\[\]]/g, "").trim();
  return cleaned.split(".").pop() || cleaned;
}

function attr(attrs: string, name: string): string | undefined {
  return attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
}

export async function scanMybatisEntities(
  projectRoot: string,
  modules: JavaModule[]
): Promise<{ entities: EntityDef[]; relations: EntityRelation[] }> {
  const entities: EntityDef[] = [];
  const relations: EntityRelation[] = [];

  for (const module of modules) {
    const moduleDir = path.join(projectRoot, module.path);
    const xmlFiles = await fg.glob(["**/*Mapper.xml", "**/*mapper.xml"], {
      cwd: moduleDir,
      absolute: true,
      ignore: ["**/target/**"],
    });

    for (const absFile of xmlFiles) {
      const content = await fs.readFile(absFile, "utf-8");
      const filePath = path
        .relative(projectRoot, absFile)
        .replace(/\\/g, "/");

      for (const rm of content.matchAll(RESULTMAP_RE)) {
        const attrsStr = rm[1];
        const body = rm[2];
        const typeAttr = attr(attrsStr, "type");
        if (!typeAttr) continue;
        const entityName = simpleName(typeAttr);

        const fields: EntityField[] = [];
        for (const r of body.matchAll(RESULT_RE)) {
          const property = attr(r[1], "property");
          if (!property) continue;
          // MyBatis resultMap carries no Java type, mark it unknown.
          fields.push({ name: property, type: "unknown", column: attr(r[1], "column") });
        }

        const rels: EntityRelation[] = [];
        for (const a of body.matchAll(ASSOC_RE)) {
          const property = attr(a[1], "property");
          const javaType = attr(a[1], "javaType");
          if (!property || !javaType) continue;
          rels.push({
            from: entityName,
            to: simpleName(javaType),
            kind: "many-to-one",
            field: property,
            source: "mybatis",
          });
        }
        for (const c of body.matchAll(COLLECTION_RE)) {
          const property = attr(c[1], "property");
          const ofType = attr(c[1], "ofType");
          if (!property || !ofType) continue;
          rels.push({
            from: entityName,
            to: simpleName(ofType),
            kind: "one-to-many",
            field: property,
            source: "mybatis",
          });
        }

        // resultMap has no table name; fall back to the class simple name.
        entities.push({
          name: entityName,
          table: entityName,
          moduleSlug: module.slug,
          filePath,
          fields,
          source: "mybatis",
        });
        relations.push(...rels);
      }
    }
  }

  return { entities, relations };
}
