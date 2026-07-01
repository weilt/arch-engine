import { parse } from "java-parser";
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
import { extractJpaEntityRegex, simpleTypeName } from "./entity-jpa-regex.js";

const RELATION_KINDS: { ann: string; kind: EntityRelationKind }[] = [
  { ann: "OneToMany", kind: "one-to-many" },
  { ann: "ManyToOne", kind: "many-to-one" },
  { ann: "OneToOne", kind: "one-to-one" },
  { ann: "ManyToMany", kind: "many-to-many" },
];

// --- Minimal structural view of a java-parser (Chevrotain) CST -----------
// java-parser's own types model every grammar rule as a distinct CstNode
// variant, which makes generic walking verbose. We work against this small
// structural shape instead; the tree has the same runtime structure.
interface AstToken {
  image: string;
  startOffset: number;
}
interface AstNode {
  name?: string;
  children?: Record<string, AstElement[]>;
}
type AstElement = AstToken | AstNode;

function isToken(el: AstElement | undefined): el is AstToken {
  return !!el && typeof (el as AstToken).image === "string";
}

/** Direct child nodes named `key` (tokens filtered out), in source order. */
function nodes(parent: AstNode | undefined, key: string): AstNode[] {
  const arr = parent?.children?.[key];
  return arr ? arr.filter((c): c is AstNode => !isToken(c)) : [];
}

function firstNode(
  parent: AstNode | undefined,
  key: string
): AstNode | undefined {
  return nodes(parent, key)[0];
}

/** Direct child tokens named `key`. */
function tokens(parent: AstNode | undefined, key: string): AstToken[] {
  const arr = parent?.children?.[key];
  return arr ? arr.filter(isToken) : [];
}

/** Every token under `node` (DFS), sorted by source position. */
function collectTokens(
  node: AstNode | undefined,
  out: AstToken[] = []
): AstToken[] {
  const arr = node?.children;
  if (!arr) return out;
  for (const key in arr) {
    for (const el of arr[key] ?? []) {
      if (isToken(el)) out.push(el);
      else collectTokens(el, out);
    }
  }
  return out.sort((a, b) => a.startOffset - b.startOffset);
}

/** First token reachable from `node` by DFS. */
function firstTokenDeep(node: AstNode | undefined): string | undefined {
  const arr = node?.children;
  if (!arr) return undefined;
  for (const key in arr) {
    for (const el of arr[key] ?? []) {
      if (isToken(el)) return el.image;
      const deeper = firstTokenDeep(el);
      if (deeper !== undefined) return deeper;
    }
  }
  return undefined;
}

/** Rebuild the raw field type text (e.g. "List<OrderItemDO>") from the CST. */
function typeText(unannType: AstNode | undefined): string {
  return collectTokens(unannType)
    .map((t) => t.image)
    .join("");
}

/** Simple class name of an annotation (last segment of the type name). */
function annotationName(ann: AstNode | undefined): string | undefined {
  const idents = tokens(firstNode(ann, "typeName"), "Identifier");
  return idents.length ? idents[idents.length - 1]!.image : undefined;
}

/** `name=value` arguments of a normal annotation, keyed by argument name. */
function annotationArgs(ann: AstNode | undefined): Map<string, string> {
  const args = new Map<string, string>();
  const pairList = firstNode(ann, "elementValuePairList");
  for (const pair of nodes(pairList, "elementValuePair")) {
    const keyTok = tokens(pair, "Identifier")[0];
    const valueImg = firstTokenDeep(firstNode(pair, "elementValue"));
    if (keyTok && valueImg !== undefined) args.set(keyTok.image, valueImg);
  }
  return args;
}

function stripQuotes(s: string): string {
  return s.replace(/^["']+|["']+$/g, "");
}

/** First `classDeclaration` node in the compilation unit (top-level order). */
function firstClassDeclaration(cst: AstNode): AstNode | undefined {
  const cu =
    firstNode(cst, "ordinaryCompilationUnit") ??
    firstNode(cst, "modularCompilationUnit");
  for (const td of nodes(cu, "typeDeclaration")) {
    const cd = firstNode(td, "classDeclaration");
    if (cd) return cd;
  }
  return undefined;
}

/** Annotations applied to the class itself (via classModifier). */
function classAnnotations(classDecl: AstNode | undefined): AstNode[] {
  const anns: AstNode[] = [];
  for (const mod of nodes(classDecl, "classModifier")) {
    anns.push(...nodes(mod, "annotation"));
  }
  return anns;
}

/** Annotations applied to a field (via fieldModifier). */
function fieldAnnotations(fieldDecl: AstNode): AstNode[] {
  const anns: AstNode[] = [];
  for (const mod of nodes(fieldDecl, "fieldModifier")) {
    anns.push(...nodes(mod, "annotation"));
  }
  return anns;
}

function processField(
  fieldDecl: AstNode,
  className: string,
  fields: EntityField[],
  relations: EntityRelation[]
): void {
  const anns = fieldAnnotations(fieldDecl);
  const names = anns
    .map((a) => annotationName(a))
    .filter((n): n is string => !!n);
  const fieldType = typeText(firstNode(fieldDecl, "unannType"));
  const vdl = firstNode(fieldDecl, "variableDeclaratorList");
  const fieldName = tokens(
    firstNode(firstNode(vdl, "variableDeclarator"), "variableDeclaratorId"),
    "Identifier"
  )[0]?.image;
  if (!fieldName) return;

  // Mirrors the regex scanner: relations take precedence; a relation field is
  // never also emitted as a column.
  let matchedRelation = false;
  for (const { ann, kind } of RELATION_KINDS) {
    if (names.includes(ann)) {
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
  if (matchedRelation) return;

  if (names.includes("Column")) {
    const args = annotationArgs(
      anns.find((a) => annotationName(a) === "Column")
    );
    const nameArg = args.get("name");
    const nullableArg = args.get("nullable");
    fields.push({
      name: fieldName,
      type: simpleTypeName(fieldType),
      column: nameArg ? stripQuotes(nameArg) : fieldName,
      // JPA @Column defaults to nullable when the attribute is absent.
      nullable: nullableArg ? nullableArg === "true" : true,
    });
  }
}

/**
 * Extract one file's JPA entity + relations from its CST. `parse` is allowed
 * to throw (invalid/unsupported Java); the caller catches and falls back to
 * regex. Returns `{ entity: null }` when no entity class can be identified.
 */
function extractEntityFromAst(
  content: string,
  moduleSlug: string,
  filePath: string
): { entity: EntityDef | null; relations: EntityRelation[] } {
  const cst = parse(content) as unknown as AstNode;

  const classDecl = firstClassDeclaration(cst);
  const ncd = firstNode(classDecl, "normalClassDeclaration");
  const className = tokens(
    firstNode(ncd, "typeIdentifier"),
    "Identifier"
  )[0]?.image;
  if (!className) return { entity: null, relations: [] };

  let table = className;
  for (const ann of classAnnotations(classDecl)) {
    if (annotationName(ann) === "Table") {
      const nameArg = annotationArgs(ann).get("name");
      if (nameArg) table = stripQuotes(nameArg);
    }
  }

  const fields: EntityField[] = [];
  const relations: EntityRelation[] = [];

  const classBody = firstNode(ncd, "classBody");
  for (const bd of nodes(classBody, "classBodyDeclaration")) {
    const member = firstNode(bd, "classMemberDeclaration");
    for (const fd of nodes(member, "fieldDeclaration")) {
      processField(fd, className, fields, relations);
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

/**
 * AST-first JPA entity scanner. For each `@Entity` file, it parses the Java
 * source with `java-parser` and walks the CST. When a single file fails to
 * parse (invalid or unsupported Java), that one file is extracted via the
 * regex path while every other file still uses the AST path — so output stays
 * identical to the regex scanner.
 */
export async function scanJpaEntitiesAst(
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
      if (!/@Entity\b/.test(content)) continue;

      const filePath = path
        .relative(projectRoot, absFile)
        .replace(/\\/g, "/");

      let result: { entity: EntityDef | null; relations: EntityRelation[] };
      try {
        result = extractEntityFromAst(content, module.slug, filePath);
      } catch {
        // CST parsing failed for this file only — recover via regex.
        result = extractJpaEntityRegex(content, module.slug, filePath);
      }
      if (result.entity === null) {
        // Parsed but no entity class identified; mirror the regex decision.
        result = extractJpaEntityRegex(content, module.slug, filePath);
      }
      if (result.entity) {
        entities.push(result.entity);
        relations.push(...result.relations);
      }
    }
  }

  return { entities, relations };
}
