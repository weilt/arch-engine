import fs from "node:fs/promises";
import path from "node:path";
import { getArchDir } from "../paths.js";
import type {
  EntityDef,
  EntityField,
  EntityGraph,
  EntityRelation,
} from "../types.js";

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderFieldRow(field: EntityField): string {
  const column = field.column ?? "-";
  const nullable =
    field.nullable === undefined ? "-" : field.nullable ? "yes" : "no";
  return `| ${escapeCell(field.name)} | ${escapeCell(field.type)} | ${escapeCell(column)} | ${nullable} |`;
}

function renderEntitySection(entity: EntityDef): string {
  const lines: string[] = [
    `## ${entity.name}`,
    "",
    `Table: \`${entity.table}\` | Source: ${entity.source} | Module: ${entity.moduleSlug}`,
    "",
    "| Field | Type | Column | Nullable |",
    "|-------|------|--------|----------|",
  ];

  if (entity.fields.length === 0) {
    lines.push("| _No fields discovered._ |   |   |   |");
  } else {
    for (const field of entity.fields) {
      lines.push(renderFieldRow(field));
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderRelationLine(relation: EntityRelation): string {
  return `- ${relation.from} → ${relation.to} (${relation.kind}) [source: ${relation.source}]`;
}

function renderEntitiesMarkdown(graph: EntityGraph): string {
  const lines: string[] = ["# Entities", ""];

  if (graph.entities.length === 0) {
    lines.push("_No entities discovered._", "");
  } else {
    for (const entity of graph.entities) {
      lines.push(renderEntitySection(entity));
    }
  }

  lines.push("## Relations", "");
  if (graph.relations.length === 0) {
    lines.push("_No relations discovered._", "");
  } else {
    for (const relation of graph.relations) {
      lines.push(renderRelationLine(relation));
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}

export async function writeEntityDocs(
  projectRoot: string,
  graph: EntityGraph,
): Promise<void> {
  const dir = getArchDir(projectRoot);
  await atomicWrite(path.join(dir, "entities.md"), renderEntitiesMarkdown(graph));
  await atomicWrite(
    path.join(dir, "entities.json"),
    JSON.stringify(graph, null, 2),
  );
}
