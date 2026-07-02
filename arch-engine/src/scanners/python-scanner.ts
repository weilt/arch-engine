import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { scanProtoServices } from "./proto-scanner.js";
import type {
  PythonModule,
  PythonClass,
  PythonApiEndpoint,
  PythonMethodNode,
} from "../types.js";

export interface PythonScanResult {
  modules: PythonModule[];
  apis: PythonApiEndpoint[];
  classes: PythonClass[];
  methods: PythonMethodNode[];
  callEdges: { source: string; target: string; kind: "calls" }[];
}

// --- Regex patterns ---

// Class definition with a base class: `class Foo(Bar):`
const CLASS_RE = /^class\s+(\w+)\s*\(\s*([\w.]+)\s*\)\s*:/;
// Bare class header for enclosing-class tracking: `class Foo:` or `class Foo(Bar):`
const ANY_CLASS_RE = /^class\s+(\w+)/;
// Function/method definition: `def name(` or `async def name(`
const DEF_RE = /^(?:async\s+)?def\s+(\w+)\s*\(/;
// Method call: `recv.method(`
const CALL_RE = /(\w+)\.(\w+)\s*\(/g;
// Pydantic annotated field: `name: type`
const PYDANTIC_FIELD_RE = /^(\w+)\s*:\s*(\S+)/;
// SQLAlchemy column field: `name = Column(`
const SA_FIELD_RE = /^(\w+)\s*=\s*Column\(/;
// Django model field: `name = models.CharField(`
const DJANGO_FIELD_RE = /^(\w+)\s*=\s*models\.(\w+)/;
// SQLAlchemy table name: `__tablename__ = "orders"`
const SA_TABLE_RE = /__tablename__\s*=\s*["']([^"']+)["']/;
// FastAPI / Flask shorthand route decorator: `@app.get("/...")` / `@router.get(...)`
const ROUTE_DECORATOR_RE =
  /^@(?:app|router|bp)\.(get|post|put|delete|patch)\(\s*["']([^"']+)["']/i;
// Flask classic route decorator: `@app.route("/...")`
const FLASK_ROUTE_RE = /^@app\.route\(\s*["']([^"']+)["']/;
// Flask methods argument inside @app.route(...)
const FLASK_METHODS_RE = /methods\s*=\s*\[?["'](\w+)["']/;
// Django URL pattern: `path("...", view)` / `re_path(r"...", view)`
const DJANGO_PATH_RE =
  /(?:re_)?path\(\s*r?["']([^"']+)["']\s*,\s*([\w.]+)\s*\)/;
// Tornado URL tuple: `(r"/pattern", Handler)`
const TORNADO_URL_RE = /^\(\s*r?["']([^"']+)["']\s*,\s*(\w+)\s*\)/;

// --- Indentation helpers ---

interface PyLine {
  raw: string;
  text: string;
  indent: number;
  index: number;
}

function toLines(content: string): PyLine[] {
  return content.split("\n").map((raw, index) => {
    const lead = raw.match(/^[ \t]*/)?.[0].length ?? 0;
    return { raw, text: raw.trim(), indent: lead, index };
  });
}

/**
 * Return the body block of the definition at *defIndex*: every subsequent
 * non-blank line indented MORE than the definition line, stopping at the
 * first dedent. This is the indentation-aware analogue of brace-matching.
 */
function blockBody(lines: PyLine[], defIndex: number): PyLine[] {
  const defIndent = lines[defIndex]!.indent;
  const body: PyLine[] = [];
  for (let i = defIndex + 1; i < lines.length; i++) {
    const ln = lines[i]!;
    if (ln.text.length === 0) continue; // blank lines don't terminate
    if (ln.indent > defIndent) body.push(ln);
    else break;
  }
  return body;
}

/**
 * Given a decorator at *fromIndex*, find the handler function name on the
 * `def` line that follows (skipping blank lines and stacked decorators).
 */
function findHandlerName(lines: PyLine[], fromIndex: number): string {
  for (let i = fromIndex + 1; i < Math.min(fromIndex + 6, lines.length); i++) {
    const text = lines[i]!.text;
    if (text.length === 0 || text.startsWith("@")) continue;
    const m = text.match(/(?:async\s+)?def\s+(\w+)\s*\(/);
    if (m) return m[1]!;
    return "unknown";
  }
  return "unknown";
}

// --- Module discovery ---

/** Extract `[project] name = "..."` (PEP 621) from pyproject.toml text. */
function extractPep621Name(content: string): string | undefined {
  const lines = content.split("\n");
  let inSection = false;
  for (const raw of lines) {
    const t = raw.trim();
    if (/^\[project\]/.test(t)) {
      inSection = true;
      continue;
    }
    if (/^\[/.test(t) && inSection) break; // next table
    if (inSection) {
      const m = t.match(/^name\s*=\s*["']([^"']+)["']/);
      if (m) return m[1];
    }
  }
  return undefined;
}

/** Extract `setup(name="...")` from setup.py text. */
function extractSetupName(content: string): string | undefined {
  const m = content.match(/setup\s*\([\s\S]*?\bname\s*=\s*["']([^"']+)["']/);
  return m?.[1];
}

async function discoverModule(
  repoRoot: string,
  repoSlug: string
): Promise<PythonModule> {
  let name = path.basename(path.resolve(repoRoot));
  try {
    const pyproject = await fs.readFile(
      path.join(repoRoot, "pyproject.toml"),
      "utf-8"
    );
    const pepName = extractPep621Name(pyproject);
    if (pepName) name = pepName;
  } catch {
    try {
      const setup = await fs.readFile(path.join(repoRoot, "setup.py"), "utf-8");
      const setupName = extractSetupName(setup);
      if (setupName) name = setupName;
    } catch {
      // no pyproject.toml / setup.py — directory basename is the fallback
    }
  }
  return { slug: repoSlug, name, path: repoRoot, repoSlug };
}

// --- Per-file extraction ---

function scanClasses(
  lines: PyLine[],
  filePath: string,
  moduleSlug: string,
  repoSlug: string,
  out: PythonClass[]
): void {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.text.match(CLASS_RE);
    if (!m) continue;

    const name = m[1]!;
    const baseClass = m[2]!;
    const body = blockBody(lines, i);
    const bodyText = body.map((l) => l.text).join("\n");

    let ormType: PythonClass["ormType"] | null = null;
    let fields: { name: string; type: string; annotation?: string }[] = [];
    let tableName: string | undefined;

    if (baseClass === "BaseModel") {
      ormType = "pydantic";
      for (const bl of body) {
        const fm = bl.text.match(PYDANTIC_FIELD_RE);
        if (fm) fields.push({ name: fm[1]!, type: fm[2]!, annotation: fm[2] });
      }
    } else if (baseClass === "models.Model") {
      ormType = "django";
      for (const bl of body) {
        const fm = bl.text.match(DJANGO_FIELD_RE);
        if (fm)
          fields.push({
            name: fm[1]!,
            type: "models." + fm[2]!,
            annotation: fm[2],
          });
      }
    } else if (
      bodyText.includes("__tablename__") ||
      bodyText.includes("Column(") ||
      bodyText.includes("mapped_column(")
    ) {
      ormType = "sqlalchemy";
      const tabM = bodyText.match(SA_TABLE_RE);
      if (tabM) tableName = tabM[1];
      for (const bl of body) {
        const fm = bl.text.match(SA_FIELD_RE);
        if (fm) {
          const typeM = bl.text.match(/Column\(\s*(\w+)/);
          const colType = typeM ? typeM[1]! : "Column";
          fields.push({ name: fm[1]!, type: colType, annotation: colType });
        }
      }
    }

    if (ormType === null) continue; // not a data entity
    out.push({
      name,
      baseClass,
      ormType,
      fields,
      tableName,
      filePath,
      moduleSlug,
      repoSlug,
    });
  }
}

function scanHttpApis(
  lines: PyLine[],
  filePath: string,
  moduleSlug: string,
  repoSlug: string,
  out: PythonApiEndpoint[],
  nextId: () => string
): void {
  // Detect FastAPI vs Flask from imports to disambiguate `@app.get(...)`.
  const hasFastAPI = lines.some((l) =>
    /^\s*(?:from\s+fastapi\b|import\s+fastapi\b)/.test(l.raw)
  );

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.text;

    // FastAPI / Flask shorthand: @app.get("/...") / @router.get(...) / @bp.get(...)
    let m = text.match(ROUTE_DECORATOR_RE);
    if (m) {
      const obj = text.match(/^@(\w+)\./)?.[1];
      const framework: PythonApiEndpoint["framework"] =
        obj === "router"
          ? "fastapi"
          : obj === "bp"
            ? "flask"
            : hasFastAPI
              ? "fastapi"
              : "flask";
      out.push({
        id: nextId(),
        method: m[1]!.toUpperCase(),
        path: m[2]!,
        handlerFunc: findHandlerName(lines, i),
        framework,
        moduleSlug,
        repoSlug,
      });
      continue;
    }

    // Flask classic: @app.route("/...", methods=["POST"])
    m = text.match(FLASK_ROUTE_RE);
    if (m) {
      const methodsM = text.match(FLASK_METHODS_RE);
      out.push({
        id: nextId(),
        method: methodsM ? methodsM[1]!.toUpperCase() : "GET",
        path: m[1]!,
        handlerFunc: findHandlerName(lines, i),
        framework: "flask",
        moduleSlug,
        repoSlug,
      });
      continue;
    }

    // Django: path("...", view) / re_path(r"...", view)
    m = text.match(DJANGO_PATH_RE);
    if (m) {
      out.push({
        id: nextId(),
        method: "GET",
        path: m[1]!,
        handlerFunc: m[2]!,
        framework: "django",
        moduleSlug,
        repoSlug,
      });
      continue;
    }

    // Tornado: (r"/pattern", Handler) tuples
    m = text.match(TORNADO_URL_RE);
    if (m) {
      out.push({
        id: nextId(),
        method: "GET",
        path: m[1]!,
        handlerFunc: m[2]!,
        framework: "tornado",
        moduleSlug,
        repoSlug,
      });
    }
  }
}

function scanMethods(
  lines: PyLine[],
  filePath: string,
  moduleSlug: string,
  repoSlug: string,
  outMethods: PythonMethodNode[],
  outEdges: { source: string; target: string; kind: "calls" }[],
  nextId: () => string
): void {
  // Collect class headers for enclosing-class detection.
  const classDefs: { name: string; index: number; indent: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.text.match(ANY_CLASS_RE);
    if (m) classDefs.push({ name: m[1]!, index: i, indent: lines[i]!.indent });
  }

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    const m = ln.text.match(DEF_RE);
    if (!m) continue;

    const funcName = m[1]!;
    const signature = ln.text;

    // Find enclosing class: most recent class before this def at lower indent.
    let className: string | undefined;
    for (const cd of classDefs) {
      if (cd.index < i && cd.indent < ln.indent) className = cd.name;
    }

    const methodId = nextId();
    outMethods.push({
      id: methodId,
      className,
      name: funcName,
      signature,
      filePath,
      moduleSlug,
      repoSlug,
    });

    // Extract call edges from the indentation-bounded function body.
    const body = blockBody(lines, i);
    const bodyText = body.map((l) => l.raw).join("\n");
    for (const cm of bodyText.matchAll(CALL_RE)) {
      const recv = cm[1]!;
      const method = cm[2]!;
      // self.method() resolves to ClassName.method; everything else is
      // best-effort (field/client.method()).
      const target =
        recv === "self" && className
          ? `${className}.${method}`
          : `${recv}.${method}`;
      outEdges.push({ source: methodId, target, kind: "calls" });
    }
  }
}

// --- Main entry point ---

/**
 * Scan a Python repository for the module definition, HTTP/gRPC APIs, ORM
 * entity classes, and a function-level call graph. All per-file errors are
 * swallowed so the scan never throws on individual file problems.
 */
export async function scanPythonSources(
  repoRoot: string,
  repoSlug: string
): Promise<PythonScanResult> {
  const module = await discoverModule(repoRoot, repoSlug);
  const moduleSlug = module.slug;

  let apiCounter = 0;
  let methodCounter = 0;

  const result: PythonScanResult = {
    modules: [module],
    apis: [],
    classes: [],
    methods: [],
    callEdges: [],
  };

  // Walk all .py source files (same glob convention as go-scanner).
  let pyFiles: string[];
  try {
    pyFiles = await fg.glob("**/*.py", {
      cwd: repoRoot,
      absolute: true,
      ignore: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.venv/**",
        "**/venv/**",
      ],
    });
  } catch {
    pyFiles = [];
  }

  for (const absFile of pyFiles) {
    let content: string;
    try {
      content = await fs.readFile(absFile, "utf-8");
    } catch {
      continue;
    }
    const filePath = path.relative(repoRoot, absFile).replace(/\\/g, "/");
    const lines = toLines(content);

    try {
      scanClasses(lines, filePath, moduleSlug, repoSlug, result.classes);
      scanHttpApis(
        lines,
        filePath,
        moduleSlug,
        repoSlug,
        result.apis,
        () => `py-api-${repoSlug}-${apiCounter++}`
      );
      scanMethods(
        lines,
        filePath,
        moduleSlug,
        repoSlug,
        result.methods,
        result.callEdges,
        () => `py-method-${repoSlug}-${methodCounter++}`
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
          id: `py-grpc-${repoSlug}-${apiCounter++}`,
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

  // Deduplicate call edges (same source -> target may appear multiple times).
  const seen = new Set<string>();
  result.callEdges = result.callEdges.filter((e) => {
    const key = `${e.source}\0${e.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return result;
}
