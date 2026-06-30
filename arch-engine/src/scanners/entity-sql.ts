import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type {
  EntityDef,
  EntityField,
  EntityRelation,
} from "../types.js";

// CREATE TABLE [IF NOT EXISTS] name ( ... ) with the closing paren on its own
// line. The newline-guard avoids stopping inside inline types like DECIMAL(10,2).
const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"]?[\w.]+[`"]?)\s*\(([\s\S]*?)\n\s*\)\s*;?/gi;
const FK_RE =
  /FOREIGN\s+KEY\s*\(\s*[`"]?(\w+)[`"]?\s*\)\s*REFERENCES\s+[`"]?([\w.]+)[`"]?\s*\(/gi;

const RESERVED_LINE_RE =
  /^\s*(?:PRIMARY|FOREIGN|UNIQUE|KEY|INDEX|CONSTRAINT|CHECK)\b/i;

function stripQuotes(token: string): string {
  return token.replace(/[`"]/g, "");
}

function tableName(rawToken: string): string {
  const cleaned = stripQuotes(rawToken);
  return cleaned.split(".").pop() || cleaned;
}

export async function scanSqlEntities(
  projectRoot: string
): Promise<{ entities: EntityDef[]; relations: EntityRelation[] }> {
  const entities: EntityDef[] = [];
  const relations: EntityRelation[] = [];

  const sqlFiles = await fg.glob("**/*.sql", {
    cwd: projectRoot,
    absolute: true,
    ignore: ["**/node_modules/**", "**/target/**", "**/.git/**"],
  });

  for (const absFile of sqlFiles) {
    const content = await fs.readFile(absFile, "utf-8");
    const filePath = path.relative(projectRoot, absFile).replace(/\\/g, "/");

    for (const ct of content.matchAll(CREATE_TABLE_RE)) {
      const table = tableName(ct[1]);
      const body = ct[2];

      const fields: EntityField[] = [];
      for (const line of body.split(/\r?\n/)) {
        const trimmed = line.trim().replace(/,$/, "").trim();
        if (!trimmed || trimmed.startsWith("--")) continue;
        if (RESERVED_LINE_RE.test(trimmed)) continue;

        const colMatch = trimmed.match(
          /^[`"]?(\w+)[`"]?\s+([A-Za-z_]\w*(?:\s*\([^)]*\))?)/
        );
        if (!colMatch) continue;
        const columnName = colMatch[1];
        const rawType = colMatch[2];
        const type = rawType.match(/^([A-Za-z_]\w*)/)?.[1] ?? rawType;
        const nullable = !/\bNOT\s+NULL\b/i.test(trimmed);
        fields.push({ name: columnName, type, column: columnName, nullable });
      }

      const rels: EntityRelation[] = [];
      for (const fk of body.matchAll(FK_RE)) {
        rels.push({
          from: table,
          to: tableName(fk[2]),
          kind: "fk-reference",
          field: fk[1],
          source: "sql",
        });
      }

      entities.push({
        name: table,
        table,
        moduleSlug: "",
        filePath,
        fields,
        source: "sql",
      });
      relations.push(...rels);
    }
  }

  return { entities, relations };
}
