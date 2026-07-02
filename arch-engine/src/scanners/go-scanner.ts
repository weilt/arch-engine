import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { scanProtoServices } from "./proto-scanner.js";
import type {
  GoModule,
  GoStruct,
  GoApiEndpoint,
  GoMethodNode,
} from "../types.js";

export interface GoScanResult {
  modules: GoModule[];
  apis: GoApiEndpoint[];
  structs: GoStruct[];
  methods: GoMethodNode[];
  callEdges: { source: string; target: string; kind: "calls" }[];
}

// ── Regex patterns ──────────────────────────────────────────────

// `module github.com/foo/bar` from go.mod
const MOD_NAME_RE = /^module\s+(\S+)/m;

// HTTP route registrations per framework. Group 3 optionally captures the
// handler expression (second argument) for best-effort handlerFunc.
const GIN_ROUTE_RE =
  /r\.(GET|POST|PUT|DELETE|PATCH)\(\s*["']([^"']+)["'](?:\s*,\s*([^,)]+))?/g;
const ECHO_ROUTE_RE =
  /e\.(GET|POST|PUT|DELETE|PATCH)\(\s*["']([^"']+)["'](?:\s*,\s*([^,)]+))?/g;
const CHI_ROUTE_RE =
  /r\.(Get|Post|Put|Delete|Patch)\(\s*["']([^"']+)["'](?:\s*,\s*([^,)]+))?/g;
const NETHTTP_ROUTE_RE =
  /http\.HandleFunc\(\s*["']([^"']+)["'](?:\s*,\s*([^,)]+))?/g;

// Best-effort group prefix: `r.Group("/api")`, `router.Group("/v1")`
const GROUP_RE = /\w+\.Group\(\s*["']([^"']+)["']/g;

// `type Foo struct {`
const STRUCT_RE = /type\s+(\w+)\s+struct\s*\{/g;

// `func (recv) Name(` or `func Name(`
const FUNC_RE = /func\s+(\([^)]*\))?\s*(\w+)\s*\(/g;

// Method call: `receiver.Method(`
const CALL_RE = /(\w+)\.(\w+)\s*\(/g;

// ── Brace-matching helper ───────────────────────────────────────

/** Return the index of the `}` matching the `{` at *openIndex*, or -1. */
function findMatchingBrace(content: string, openIndex: number): number {
  let depth = 1;
  let i = openIndex + 1;
  while (i < content.length) {
    const ch = content[i]!;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// ── Module discovery ────────────────────────────────────────────

async function discoverModule(
  repoRoot: string,
  repoSlug: string
): Promise<GoModule> {
  let name = path.basename(path.resolve(repoRoot));
  try {
    const modContent = await fs.readFile(
      path.join(repoRoot, "go.mod"),
      "utf-8"
    );
    const match = modContent.match(MOD_NAME_RE);
    if (match) name = match[1]!;
  } catch {
    // no go.mod — directory basename is the fallback name
  }
  return { slug: repoSlug, name, path: repoRoot, repoSlug };
}

// ── Struct field parsing ────────────────────────────────────────

function parseStructFields(
  body: string
): { name: string; type: string; tag?: string }[] {
  const fields: { name: string; type: string; tag?: string }[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;

    // Extract backtick-delimited struct tag, preferring the json name.
    let tag: string | undefined;
    let lineWithoutTag = line;
    const tagMatch = line.match(/`([^`]*)`/);
    if (tagMatch) {
      lineWithoutTag = line.replace(/`[^`]*`/, "").trim();
      const jsonMatch = tagMatch[1]!.match(/json:"([^"]*)"/);
      tag = jsonMatch ? jsonMatch[1] : tagMatch[1];
    }

    // `fieldName fieldType` — skip embedded / anonymous fields.
    const parts = lineWithoutTag.split(/\s+/);
    if (parts.length < 2) continue;

    fields.push({
      name: parts[0]!,
      type: parts.slice(1).join(" "),
      tag,
    });
  }
  return fields;
}

// ── Per-file extraction helpers ─────────────────────────────────

function scanStructs(
  content: string,
  filePath: string,
  moduleSlug: string,
  repoSlug: string,
  out: GoStruct[]
): void {
  for (const match of content.matchAll(STRUCT_RE)) {
    const name = match[1]!;
    // The `{` is the last character of the match text.
    const braceStart = match.index! + match[0].length - 1;
    const braceEnd = findMatchingBrace(content, braceStart);
    if (braceEnd === -1) continue;
    const body = content.slice(braceStart + 1, braceEnd);
    out.push({
      name,
      fields: parseStructFields(body),
      filePath,
      moduleSlug,
      repoSlug,
    });
  }
}

function scanHttpApis(
  content: string,
  filePath: string,
  moduleSlug: string,
  repoSlug: string,
  out: GoApiEndpoint[],
  nextId: () => string
): void {
  // Best-effort group prefix: the most recent `.Group("prefix")` before a
  // route registration is prepended to the route path.
  const groups: { index: number; prefix: string }[] = [];
  for (const gm of content.matchAll(GROUP_RE)) {
    groups.push({ index: gm.index!, prefix: gm[1]! });
  }
  const prefixAt = (idx: number): string => {
    let prefix = "";
    for (const g of groups) {
      if (g.index <= idx) prefix = g.prefix;
      else break;
    }
    return prefix;
  };

  const add = (
    method: string,
    rawPath: string,
    handler: string | undefined,
    framework: GoApiEndpoint["framework"],
    index: number
  ): void => {
    out.push({
      id: nextId(),
      method,
      path: prefixAt(index) + rawPath,
      handlerFunc: handler?.trim() || "unknown",
      framework,
      moduleSlug,
      repoSlug,
    });
  };

  for (const m of content.matchAll(GIN_ROUTE_RE))
    add(m[1]!, m[2]!, m[3], "gin", m.index!);
  for (const m of content.matchAll(ECHO_ROUTE_RE))
    add(m[1]!, m[2]!, m[3], "echo", m.index!);
  for (const m of content.matchAll(CHI_ROUTE_RE))
    add(m[1]!.toUpperCase(), m[2]!, m[3], "chi", m.index!);
  for (const m of content.matchAll(NETHTTP_ROUTE_RE))
    add("GET", m[1]!, m[2], "net-http", m.index!);
}

function scanMethods(
  content: string,
  filePath: string,
  moduleSlug: string,
  repoSlug: string,
  outMethods: GoMethodNode[],
  outEdges: { source: string; target: string; kind: "calls" }[],
  nextId: () => string
): void {
  for (const match of content.matchAll(FUNC_RE)) {
    const receiverRaw = match[1];
    const funcName = match[2]!;

    // Parse receiver `(s *Type)` → type="Type".
    let receiverType = "";
    if (receiverRaw) {
      const inner = receiverRaw.slice(1, -1).trim();
      const sp = inner.search(/\s/);
      receiverType =
        sp > 0
          ? inner.slice(sp).trim().replace(/^\*/, "").trim()
          : inner.replace(/^\*/, "").trim();
    }

    // Find the opening `{` of the function body, then brace-match.
    const matchEnd = match.index! + match[0].length;
    let braceStart = -1;
    for (let i = matchEnd; i < content.length; i++) {
      if (content[i] === "{") {
        braceStart = i;
        break;
      }
    }
    if (braceStart === -1) continue;
    const braceEnd = findMatchingBrace(content, braceStart);
    if (braceEnd === -1) continue;

    const body = content.slice(braceStart + 1, braceEnd);
    const signature = content.slice(match.index!, braceStart).trim();

    const methodId = nextId();
    outMethods.push({
      id: methodId,
      receiver: receiverType,
      name: funcName,
      signature,
      filePath,
      moduleSlug,
      repoSlug,
    });

    // Extract call edges: `receiver.Method(` → edge to `receiver.Method`.
    for (const cm of body.matchAll(CALL_RE)) {
      const recv = cm[1]!;
      const method = cm[2]!;
      outEdges.push({
        source: methodId,
        target: `${recv}.${method}`,
        kind: "calls",
      });
    }
  }
}

// ── Main entry point ────────────────────────────────────────────

/**
 * Scan a Go repository for modules, HTTP/gRPC APIs, struct entities, and a
 * function-level call graph. All per-file errors are swallowed so the scan
 * never throws on individual file problems.
 */
export async function scanGoSources(
  repoRoot: string,
  repoSlug: string
): Promise<GoScanResult> {
  const module = await discoverModule(repoRoot, repoSlug);
  const moduleSlug = module.slug;

  let apiCounter = 0;
  let methodCounter = 0;

  const result: GoScanResult = {
    modules: [module],
    apis: [],
    structs: [],
    methods: [],
    callEdges: [],
  };

  // Walk all .go source files (same glob convention as proto-scanner).
  let goFiles: string[];
  try {
    goFiles = await fg.glob("**/*.go", {
      cwd: repoRoot,
      absolute: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/vendor/**"],
    });
  } catch {
    goFiles = [];
  }

  for (const absFile of goFiles) {
    let content: string;
    try {
      content = await fs.readFile(absFile, "utf-8");
    } catch {
      continue;
    }
    const filePath = path.relative(repoRoot, absFile).replace(/\\/g, "/");

    try {
      scanStructs(content, filePath, moduleSlug, repoSlug, result.structs);
      scanHttpApis(
        content,
        filePath,
        moduleSlug,
        repoSlug,
        result.apis,
        () => `go-api-${repoSlug}-${apiCounter++}`
      );
      scanMethods(
        content,
        filePath,
        moduleSlug,
        repoSlug,
        result.methods,
        result.callEdges,
        () => `go-method-${repoSlug}-${methodCounter++}`
      );
    } catch {
      // non-fatal: skip this file entirely
      continue;
    }
  }

  // gRPC endpoints from .proto service definitions.
  try {
    const protoServices = await scanProtoServices(repoRoot);
    for (const svc of protoServices) {
      for (const rpc of svc.rpcs) {
        result.apis.push({
          id: `go-grpc-${repoSlug}-${apiCounter++}`,
          method: "POST",
          path: `/${svc.serviceName}/${rpc.name}`,
          handlerFunc: rpc.name,
          framework: "grpc",
          moduleSlug,
          repoSlug,
        });
      }
    }
  } catch {
    // proto scanning failure is non-fatal
  }

  // Deduplicate call edges (same source → target may appear multiple times).
  const seen = new Set<string>();
  result.callEdges = result.callEdges.filter((e) => {
    const key = `${e.source}\0${e.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return result;
}
