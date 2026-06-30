import { parse } from "java-parser";
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type {
  CallGraph,
  CallGraphNode,
  CallGraphEdge,
  CallGraphEdgeKind,
  DocumentModel,
  FlowLayer,
  JavaModule,
} from "../types.js";

// ---------------------------------------------------------------------------
// Minimal structural view of a java-parser (Chevrotain) CST.
// Adapted from entity-jpa-ast.ts: java-parser models every grammar rule as a
// distinct CstNode variant, which makes generic walking verbose. We work
// against this small structural shape instead; the tree has the same runtime
// structure.
// ---------------------------------------------------------------------------
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

/** Rebuild a raw type text (e.g. "List<OrderItemDO>") from the CST. */
function typeText(unannType: AstNode | undefined): string {
  return collectTokens(unannType)
    .map((t) => t.image)
    .join("");
}

/** Simple class name: strip generics + package qualifier. */
function simpleType(t: string): string {
  const lt = t.indexOf("<");
  let base = lt >= 0 ? t.slice(0, lt) : t;
  const dot = base.lastIndexOf(".");
  if (dot >= 0) base = base.slice(dot + 1);
  return base;
}

/** Simple class name of an annotation (last segment of the type name). */
function annotationName(ann: AstNode | undefined): string | undefined {
  const idents = tokens(firstNode(ann, "typeName"), "Identifier");
  return idents.length ? idents[idents.length - 1]!.image : undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Layer detection: path/filename convention (mirrors flow-scanner, kept inline
// to avoid widening this task's edit scope into flow-scanner.ts).
// ---------------------------------------------------------------------------
function detectBackendLayer(absFile: string): FlowLayer | null {
  const p = absFile.replace(/\\/g, "/");
  if (/repository/i.test(p) || /Mapper\.java$/i.test(p)) return "repository";
  if (/service/i.test(p)) return "service";
  if (/controller/i.test(p)) return "controller";
  return null;
}

// Runtime annotations we surface on method nodes (simple class-name match).
const BEHAVIOR_ANNOTATIONS = new Set([
  "Transactional",
  "Cacheable",
  "CacheEvict",
  "CachePut",
  "PreAuthorize",
  "PostAuthorize",
  "Secured",
  "Scheduled",
  "EventListener",
  "Async",
]);

const DTO_NAME_RE = /(DTO|VO|Request|Response|Dto|Vo)$/;

// ---------------------------------------------------------------------------
// Type (class / interface) extraction
// ---------------------------------------------------------------------------
interface TypeInfo {
  name: string;
  kind: "class" | "interface";
  body: AstNode;
}

function nameOfType(typeNode: AstNode | undefined): string | undefined {
  return tokens(firstNode(typeNode, "typeIdentifier"), "Identifier")[0]?.image;
}

function extractTypeInfo(cst: AstNode): TypeInfo | null {
  const cu =
    firstNode(cst, "ordinaryCompilationUnit") ??
    firstNode(cst, "modularCompilationUnit");
  for (const td of nodes(cu, "typeDeclaration")) {
    const cd = firstNode(td, "classDeclaration");
    if (cd) {
      const ncd = firstNode(cd, "normalClassDeclaration");
      const name = nameOfType(ncd);
      const body = firstNode(ncd, "classBody");
      if (name && body) return { name, kind: "class", body };
    }
    const id = firstNode(td, "interfaceDeclaration");
    if (id) {
      const nid = firstNode(id, "normalInterfaceDeclaration");
      const name = nameOfType(nid);
      const body = firstNode(nid, "interfaceBody");
      if (name && body) return { name, kind: "interface", body };
    }
  }
  return null;
}

/** methodDeclaration (class) and interfaceMethodDeclaration share the same
 *  methodHeader / methodBody shape, so both are handled uniformly below. */
function collectMethodDecls(
  body: AstNode,
  kind: "class" | "interface"
): AstNode[] {
  const out: AstNode[] = [];
  if (kind === "class") {
    for (const bd of nodes(body, "classBodyDeclaration")) {
      const member = firstNode(bd, "classMemberDeclaration");
      out.push(...nodes(member, "methodDeclaration"));
    }
  } else {
    for (const member of nodes(body, "interfaceMemberDeclaration")) {
      out.push(...nodes(member, "interfaceMethodDeclaration"));
    }
  }
  return out;
}

function collectFieldDecls(
  body: AstNode,
  kind: "class" | "interface"
): AstNode[] {
  const out: AstNode[] = [];
  if (kind === "class") {
    for (const bd of nodes(body, "classBodyDeclaration")) {
      const member = firstNode(bd, "classMemberDeclaration");
      out.push(...nodes(member, "fieldDeclaration"));
    }
  } else {
    // interface constants (rare); included for completeness.
    for (const member of nodes(body, "interfaceMemberDeclaration")) {
      out.push(...nodes(member, "fieldDeclaration"));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Method header parsing
// ---------------------------------------------------------------------------
function methodNameOf(
  methodDeclarator: AstNode | undefined
): string | undefined {
  // The declarator's direct Identifier token is the method name (parameter
  // names are nested deeper and are not direct children).
  return tokens(methodDeclarator, "Identifier")[0]?.image;
}

function resultTypeText(methodHeader: AstNode | undefined): string {
  const result = firstNode(methodHeader, "result");
  if (!result) return "void";
  const ut = firstNode(result, "unannType");
  if (ut) return typeText(ut);
  return tokens(result, "Void")[0] ? "void" : typeText(result);
}

/** First unannType under a parameter (direct or one level down). */
function firstUnannType(node: AstNode | undefined): AstNode | undefined {
  if (!node) return undefined;
  let ut = firstNode(node, "unannType");
  if (ut) return ut;
  for (const cn of [
    "variableParaRegularParameter",
    "variableArityParameter",
    "lastFormalParameter",
  ]) {
    ut = firstNode(firstNode(node, cn), "unannType");
    if (ut) return ut;
  }
  return undefined;
}

interface ParamInfo {
  types: string[];
  requestBodyTypes: string[];
}

function extractParams(methodDeclarator: AstNode | undefined): ParamInfo {
  const types: string[] = [];
  const requestBodyTypes: string[] = [];
  const fpl = firstNode(methodDeclarator, "formalParameterList");
  for (const fp of nodes(fpl, "formalParameter")) {
    const ut = firstUnannType(fp);
    const typeStr = ut ? typeText(ut) : "";
    if (typeStr) types.push(typeStr);

    // Parameter annotations live under variableModifier -> annotation.
    const holder =
      firstNode(fp, "variableParaRegularParameter") ??
      firstNode(fp, "variableArityParameter") ??
      fp;
    let isRequestBody = false;
    for (const vm of nodes(holder, "variableModifier")) {
      for (const ann of nodes(vm, "annotation")) {
        if (annotationName(ann) === "RequestBody") isRequestBody = true;
      }
    }
    if (isRequestBody && typeStr) requestBodyTypes.push(simpleType(typeStr));
  }
  return { types, requestBodyTypes };
}

/** Behavior-relevant annotation simple-names on a method node. */
function behaviorAnnotations(methodDecl: AstNode): string[] {
  const names: string[] = [];
  const collect = (modKey: string): void => {
    for (const mod of nodes(methodDecl, modKey)) {
      for (const ann of nodes(mod, "annotation")) {
        const n = annotationName(ann);
        if (n) names.push(n);
      }
    }
  };
  collect("methodModifier");
  collect("interfaceMethodModifier");
  return names.filter((n) => BEHAVIOR_ANNOTATIONS.has(n));
}

// ---------------------------------------------------------------------------
// Fields (instance fields) -> field map for call resolution + DTO fields
// ---------------------------------------------------------------------------
interface FieldInfo {
  name: string;
  type: string;
}

function extractFields(fieldDecls: AstNode[]): FieldInfo[] {
  const fields: FieldInfo[] = [];
  for (const fd of fieldDecls) {
    const rawType = typeText(firstNode(fd, "unannType"));
    const vdl = firstNode(fd, "variableDeclaratorList");
    for (const vd of nodes(vdl, "variableDeclarator")) {
      const name = tokens(
        firstNode(vd, "variableDeclaratorId"),
        "Identifier"
      )[0]?.image;
      if (name && rawType) fields.push({ name, type: simpleType(rawType) });
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Method-call extraction
// ---------------------------------------------------------------------------
/** DFS-collect every descendant node named `name`. */
function dfsCollect(
  node: AstNode | undefined,
  name: string,
  out: AstNode[]
): void {
  const arr = node?.children;
  if (!arr) return;
  for (const key in arr) {
    for (const el of arr[key] ?? []) {
      if (isToken(el)) continue;
      if (el.name === name) out.push(el);
      dfsCollect(el, name, out);
    }
  }
}

interface CallSite {
  callee: string;
  /** "this" for a same-class receiver, a field name, or "" (bare same-class). */
  qualifier: string;
}

/**
 * Reconstruct a single call site from a `primary` whose last suffix is a
 * methodInvocationSuffix. java-parser has no `methodInvocation` node; a call
 * is `primaryPrefix (+primarySuffix)*` ending in a methodInvocationSuffix.
 *
 * We collect the primary's tokens in source order: the method name is the
 * token immediately before the first "(" (always the call's own paren,
 * preceding any argument parens); the qualifier is the identifier chain
 * before the method name ("this" when an explicit/bare receiver exists).
 */
function parsePrimaryCall(primary: AstNode): CallSite | null {
  const suffixes = nodes(primary, "primarySuffix");
  if (suffixes.length === 0) return null;
  const last = suffixes[suffixes.length - 1]!;
  if (!firstNode(last, "methodInvocationSuffix")) return null;

  const toks = collectTokens(primary);
  const parenIdx = toks.findIndex((t) => t.image === "(");
  if (parenIdx < 1) return null;

  const nameTok = toks[parenIdx - 1]!;
  if (!/^[A-Za-z_$]/.test(nameTok.image)) return null; // method name must be an identifier
  const callee = nameTok.image;

  const before = toks.slice(0, parenIdx - 1);
  const hasThis = before.some(
    (t) => t.image === "this" || t.image === "super"
  );
  if (hasThis) return { callee, qualifier: "this" };

  const qualifierIdents = before
    .filter((t) => /^[A-Za-z_$]/.test(t.image))
    .map((t) => t.image);
  return { callee, qualifier: qualifierIdents.join(".") };
}

/** Resolve a call primary into a (target, confidence) edge, or null when the
 *  qualifier gives insufficient signal (static/chained/unknown). */
function resolveCall(
  primary: AstNode,
  className: string,
  fieldMap: Map<string, string>
): { target: string; confidence: "high" | "low" } | null {
  const call = parsePrimaryCall(primary);
  if (!call) return null;
  if (call.qualifier === "this" || call.qualifier === "") {
    // `this.x()` or bare `x()` -> same-class call.
    return { target: `method:${className}#${call.callee}`, confidence: "low" };
  }
  const fieldType = fieldMap.get(call.qualifier);
  if (fieldType) {
    // `field.x()` -> cross-class call via an injected/instance field.
    return {
      target: `method:${fieldType}#${call.callee}`,
      confidence: "high",
    };
  }
  // Unknown qualifier (static, chained, etc.) -> insufficient signal.
  return null;
}

// ---------------------------------------------------------------------------
// Scanner entry point
// ---------------------------------------------------------------------------
export async function scanCallGraphJava(
  projectRoot: string,
  modules: JavaModule[],
  _model: DocumentModel
): Promise<CallGraph> {
  const graphNodes: CallGraphNode[] = [];
  const graphEdges: CallGraphEdge[] = [];
  const seenEdges = new Set<string>();

  const addEdge = (
    from: string,
    to: string,
    kind: CallGraphEdgeKind,
    confidence: "high" | "low"
  ): void => {
    const key = `${from}|${to}|${kind}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    graphEdges.push({ from, to, kind, confidence });
  };

  // Metadata for every scanned class (used to build dto nodes + the dto-name
  // set that drives `uses` edges).
  interface ClassMeta {
    className: string;
    fields: FieldInfo[];
    filePath: string;
    moduleSlug: string;
  }
  const allClasses: ClassMeta[] = [];

  // DTO candidate names: regex match OR referenced from a controller method
  // (@RequestBody param type / return type). Only candidates that resolve to a
  // scanned class become real dto nodes + `uses` edge targets.
  const dtoCandidates = new Set<string>();

  // Methods pending `uses`-edge resolution (needs the final dto-name set).
  const methodSigs: { id: string; signature: string }[] = [];

  for (const module of modules) {
    const moduleDir = path.join(projectRoot, module.path);
    let javaFiles: string[] = [];
    try {
      javaFiles = await fg.glob("**/*.java", {
        cwd: moduleDir,
        absolute: true,
        ignore: ["**/target/**"],
      });
    } catch {
      continue;
    }

    for (const absFile of javaFiles) {
     let content: string;
     try {
       content = await fs.readFile(absFile, "utf-8");
     } catch {
       continue;
     }
     // Tolerate a leading UTF-8 BOM; java-parser rejects it outright.
     if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

     let info: TypeInfo | null;
      try {
        info = extractTypeInfo(parse(content) as unknown as AstNode);
      } catch {
        // Unparseable / unsupported Java for this file only -> skip it.
        continue;
      }
      if (!info) continue;

      const { name: className, kind, body } = info;
      const filePath = path
        .relative(projectRoot, absFile)
        .replace(/\\/g, "/");
      const layer = detectBackendLayer(absFile);

      const fields = extractFields(collectFieldDecls(body, kind));
      allClasses.push({ className, fields, filePath, moduleSlug: module.slug });

      if (DTO_NAME_RE.test(className)) dtoCandidates.add(className);

      const isBackend =
        layer === "service" || layer === "controller" || layer === "repository";
      if (!isBackend) continue;

      // Field name -> type map for cross-class call resolution.
      const fieldMap = new Map<string, string>();
      for (const f of fields) fieldMap.set(f.name, f.type);

      for (const md of collectMethodDecls(body, kind)) {
        const header = firstNode(md, "methodHeader");
        const declarator = firstNode(header, "methodDeclarator");
        const mname = methodNameOf(declarator);
        if (!mname) continue;

        const returnType = resultTypeText(header);
        const { types: paramTypes, requestBodyTypes } =
          extractParams(declarator);
        const signature = `${returnType}(${paramTypes.join(", ")})`;
        const annotations = behaviorAnnotations(md).map((n) => `@${n}`);

        const id = `method:${className}#${mname}`;
        graphNodes.push({
          id,
          kind: "method",
          name: mname,
          filePath,
          moduleSlug: module.slug,
          layer: layer!,
          annotations,
          signature,
        });
        methodSigs.push({ id, signature });

        // Controller-referenced types are DTO indicators (condition 2).
        if (layer === "controller") {
          for (const t of requestBodyTypes) dtoCandidates.add(t);
          for (const t of referencedTypeNames(returnType)) dtoCandidates.add(t);
        }

        // Call edges from this method's body.
        const methodBody = firstNode(md, "methodBody");
        const primaries: AstNode[] = [];
        dfsCollect(methodBody, "primary", primaries);
        for (const primary of primaries) {
          const resolved = resolveCall(primary, className, fieldMap);
          if (resolved) addEdge(id, resolved.target, "calls", resolved.confidence);
        }
      }
    }
  }

  // Resolve dto nodes: candidates that have a scanned class definition.
  const dtoNodeNames = new Set<string>();
  const metaByClass = new Map(allClasses.map((c) => [c.className, c]));
  for (const name of dtoCandidates) {
    const meta = metaByClass.get(name);
    if (!meta) continue; // referenced but not present in source -> no node
    dtoNodeNames.add(name);
    graphNodes.push({
      id: `dto:${name}`,
      kind: "dto",
      name,
      filePath: meta.filePath,
      moduleSlug: meta.moduleSlug,
      fields: meta.fields.map((f) => ({ name: f.name, type: f.type })),
    });
  }

  // `uses` edges: a method whose signature references a known dto type.
  for (const { id, signature } of methodSigs) {
    for (const dtoName of dtoNodeNames) {
      const re = new RegExp(`\\b${escapeRegExp(dtoName)}\\b`);
      if (re.test(signature)) {
        addEdge(id, `dto:${dtoName}`, "uses", "high");
      }
    }
  }

  return { nodes: graphNodes, edges: graphEdges };
}

/** Capitalized identifiers referenced in a type text (e.g. "List<OrderDTO>"). */
function referencedTypeNames(typeStr: string): string[] {
  const out: string[] = [];
  for (const m of typeStr.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    out.push(m[1]!);
  }
  return out;
}
