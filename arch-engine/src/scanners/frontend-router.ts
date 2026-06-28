/**
 * Router / route-table extraction (regex-based, no AST).
 *
 * Detects Vue Router (createRouter, new VueRouter, new Router) and React
 * (<Route) route definitions and flattens them into top-level RouteEntry
 * records. Per spec 3.3: nested `children:` arrays are flattened with the
 * child path concatenated onto the parent path (single `/` join, double-slash
 * normalized). Mirrors the style of frontend-api.ts / frontend-vue-contract.ts:
 * pure functions, never throw, empty array when nothing is found.
 */

import type { RouteEntry } from "../types.js";

// Router construct triggers. Non-global so .test is safe without lastIndex.
const VUE_ROUTER_RE = /\bcreateRouter\b|\bnew\s+VueRouter\b|\bnew\s+Router\s*\(/;
const REACT_ROUTE_RE = /<Route\b/;

/** True when the file declares a Vue Router instance or a React <Route>. */
export function isRouterFile(content: string): boolean {
  return VUE_ROUTER_RE.test(content) || REACT_ROUTE_RE.test(content);
}

/**
 * Returns the inner text between a balanced open/close pair, starting at
 * `src[startIdx]` which must equal `open`. Tracks string literals and escapes
 * so braces inside strings don't affect nesting.
 */
function captureBalanced(
  src: string,
  open: string,
  close: string,
  startIdx: number
): { inner: string; end: number } | null {
  if (src[startIdx] !== open) return null;
  let depth = 0;
  let i = startIdx;
  let inStr: string | null = null;
  while (i < src.length) {
    const ch = src[i]!;
    if (inStr) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return { inner: src.slice(startIdx + 1, i), end: i };
    }
    i++;
  }
  return null;
}

/**
 * Walks the body of a `[ ... ]` array (its inner text) and returns the
 * relative offsets of every top-level `{` object that sits directly inside the
 * array (brace depth 1 within the array body). This is how we find each route
 * record without a parser.
 */
function findTopLevelObjects(src: string): number[] {
  const starts: number[] = [];
  let depth = 0;
  let i = 0;
  let inStr: string | null = null;
  while (i < src.length) {
    const ch = src[i]!;
    if (inStr) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === "{") {
      depth++;
      if (depth === 1) starts.push(i);
    } else if (ch === "}") {
      if (depth > 0) depth--;
    }
    i++;
  }
  return starts;
}

/**
 * Given the start index of a `{ ... }` object in `content`, splits its body
 * into top-level property segments (commas at brace/bracket/paren depth 0,
 * respecting strings). Each segment still carries its `key:` prefix.
 */
function objectSegments(content: string, objStart: number): string[] {
  const block = captureBalanced(content, "{", "}", objStart);
  if (!block) return [];
  const segs: string[] = [];
  let depth = 0;
  let i = 0;
  let inStr: string | null = null;
  let segStart = 0;
  while (i < block.inner.length) {
    const ch = block.inner[i]!;
    if (inStr) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth > 0) depth--;
    } else if (ch === "," && depth === 0) {
      segs.push(block.inner.slice(segStart, i));
      segStart = i + 1;
    }
    i++;
  }
  segs.push(block.inner.slice(segStart));
  return segs;
}

/** Reads the quoted value after a `key:` colon, returning the literal text. */
function quotedValue(seg: string): string | null {
  const m = seg.match(/:\s*(['"`])([\s\S]*?)\1/);
  return m ? m[2]! : null;
}

/**
 * Best-effort component value. For `component: HomeView` we keep "HomeView".
 * For `component: () => import('@/views/Home.vue')` we keep the import path
 * "@/views/Home.vue" (readable + resolvable). Falls back to the raw value.
 */
function componentValue(seg: string): string | undefined {
  const colonIdx = seg.indexOf(":");
  if (colonIdx < 0) return undefined;
  const rest = seg.slice(colonIdx + 1).trim();
  if (!rest) return undefined;
  const arrowImport = rest.match(/import\s*\(\s*(['"`])([\s\S]*?)\1\s*\)/);
  if (arrowImport) return arrowImport[2]!;
  const quoted = rest.match(/^(['"`])([\s\S]*?)\1/);
  if (quoted) return quoted[2]!;
  const ident = rest.match(/^[A-Za-z_$][\w$]*/);
  if (ident) return ident[0];
  return rest.replace(/[;,\s]+$/, "");
}

/**
 * Loose meta extraction: capture the `{ ... }` object after `meta:` and read
 * scalar keys (title/icon/hidden/noAuth). Quoted values are unwrapped; booleans
 * and numbers are coerced; other values keep their trimmed literal text so
 * nothing is silently lost.
 */
function metaValue(seg: string): Record<string, unknown> | undefined {
  const colonIdx = seg.indexOf(":");
  if (colonIdx < 0) return undefined;
  const after = seg.slice(colonIdx + 1);
  const braceIdx = after.indexOf("{");
  if (braceIdx < 0) return undefined;
  const block = captureBalanced(after, "{", "}", braceIdx);
  if (!block) return undefined;
  const meta: Record<string, unknown> = {};
  for (const m of block.inner.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*([^,}\n]+)/g)) {
    const key = m[1]!;
    const raw = m[2]!.trim();
    let value: unknown = raw;
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      value = raw.slice(1, -1);
    } else if (raw === "true") {
      value = true;
    } else if (raw === "false") {
      value = false;
    } else if (raw === "null") {
      value = null;
    } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
      value = Number(raw);
    }
    meta[key] = value;
  }
  if (Object.keys(meta).length === 0) return undefined;
  return meta;
}

/** Joins parent and child path segments with a single `/`, normalizing doubles. */
function joinPath(parent: string, child: string): string {
  if (!child) return normalizePath(parent);
  if (!parent) return normalizePath(child);
  const left = parent.replace(/\/+$/, "");
  const right = child.replace(/^\/+/, "");
  return normalizePath(`${left}/${right}`);
}

/**
 * Collapses runs of `/` into one and strips a trailing `/` (unless the path is
 * exactly "/", the root route). Keeps concatenated child paths clean.
 */
function normalizePath(p: string): string {
  let s = p.replace(/\/{2,}/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/**
 * Parses one `{ ... }` route record (at `objStart` in `content`) into its
 * scalar fields (path/name/component/meta). Children are handled separately by
 * re-scanning the object span, which is more robust than tracking offsets.
 */
function parseRouteFields(content: string, objStart: number) {
  const segs = objectSegments(content, objStart);
  let path = "";
  let name: string | undefined;
  let component: string | undefined;
  let meta: Record<string, unknown> | undefined;

  for (const seg of segs) {
    const keyMatch = seg.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    if (!keyMatch) continue;
    const key = keyMatch[1]!;
    if (key === "path") {
      path = quotedValue(seg) ?? "";
    } else if (key === "name") {
      name = quotedValue(seg) ?? undefined;
    } else if (key === "component") {
      component = componentValue(seg);
    } else if (key === "meta") {
      meta = metaValue(seg);
    }
  }
  return { path, name, component, meta };
}

interface RouteTable {
  absStart: number;
  inner: string;
}

/** Locates the `[ ... ]` arrays assigned to `routes:` in the file. */
function findRouteTables(content: string): RouteTable[] {
  const tables: RouteTable[] = [];
  // Match both the inline object form (`routes: [...]` inside createRouter)
  // and the common separate-const form (`const routes = [...]` passed by
  // shorthand `createRouter({ routes })`).
  for (const m of content.matchAll(/\broutes\s*[:=]\s*\[/g)) {
    const arrStart = (m.index ?? 0) + m[0].length - 1; // index of '['
    const arr = captureBalanced(content, "[", "]", arrStart);
    if (arr) tables.push({ absStart: arrStart, inner: arr.inner });
  }
  return tables;
}

/**
 * Returns the local `[` offsets of `children: [...]` arrays that sit at brace
 * depth 0 within an object body (the object's OWN children), skipping any
 * `children:` nested inside descendant route records. This is what keeps the
 * flatten walk one level deep per recursion frame, so a grandchild is never
 * re-attached to its grandparent.
 */
function findImmediateChildrenArrays(inner: string): number[] {
  const starts: number[] = [];
  let depth = 0;
  let i = 0;
  let inStr: string | null = null;
  const kw = /^children\b\s*:\s*\[/;
  while (i < inner.length) {
    const ch = inner[i]!;
    if (inStr) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) depth--;
      i++;
      continue;
    }
    if (depth === 0 && ch === "c") {
      const m = kw.exec(inner.slice(i));
      if (m) {
        starts.push(i + m[0].length - 1);
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return starts;
}

/**
 * Extracts Vue Router route tables and flattens nested `children:` arrays.
 * Each route's full path is the concatenation of its ancestors' paths.
 */
function extractVueRoutes(content: string): RouteEntry[] {
  const out: RouteEntry[] = [];

  const emitObject = (objStart: number, parentPath: string): void => {
    const fields = parseRouteFields(content, objStart);
    const fullPath = joinPath(parentPath, fields.path);
    if (fullPath) {
      const entry: RouteEntry = { path: fullPath };
      if (fields.name) entry.name = fields.name;
      if (fields.component) entry.component = fields.component;
      if (fields.meta) entry.meta = fields.meta;
      out.push(entry);
    }
    // Recurse into children arrays within this same object span.
    const obj = captureBalanced(content, "{", "}", objStart);
    if (!obj) return;
    // Only the IMMEDIATE (brace-depth-0) children array; deeper children are
    // reached when emitObject recurses into each child object.
    for (const localArrStart of findImmediateChildrenArrays(obj.inner)) {
      const absArrStart = objStart + 1 + localArrStart;
      const arr = captureBalanced(content, "[", "]", absArrStart);
      if (!arr) continue;
      for (const relObjStart of findTopLevelObjects(arr.inner)) {
        emitObject(absArrStart + 1 + relObjStart, fullPath);
      }
    }
  };

  for (const table of findRouteTables(content)) {
    for (const relObjStart of findTopLevelObjects(table.inner)) {
      emitObject(table.absStart + 1 + relObjStart, "");
    }
  }

  return out;
}

/** Extracts flat React `<Route path=...>` entries (element/component attribute). */
function extractReactRoutes(content: string): RouteEntry[] {
  const out: RouteEntry[] = [];
  for (const m of content.matchAll(/<Route\b[^>]*>/g)) {
    const tag = m[0]!;
    const pathMatch = tag.match(/\bpath\s*=\s*\{?\s*['"`]([^'"`]+)['"`]/);
    if (!pathMatch) continue;
    const entry: RouteEntry = { path: pathMatch[1]! };
    const elementMatch = tag.match(
      /\b(?:element|component)\s*=\s*\{?\s*(?:<([A-Za-z_$][\w$]*)|(['"`])([A-Za-z_$][\w$]*)\2)/
    );
    if (elementMatch) {
      entry.component = elementMatch[1] ?? elementMatch[3];
    }
    out.push(entry);
  }
  return out;
}

/**
 * Extracts all routes from the file as a flat, fully-pathed RouteEntry[].
 * Children are flattened with their path concatenated to the parent path
 * (single `/` join, `//` normalized). Returns [] when no routes are found.
 * Order: Vue router tables first, then React <Route> elements.
 */
export function extractRoutes(content: string): RouteEntry[] {
  const routes: RouteEntry[] = [];
  if (VUE_ROUTER_RE.test(content)) {
    routes.push(...extractVueRoutes(content));
  }
  if (REACT_ROUTE_RE.test(content)) {
    routes.push(...extractReactRoutes(content));
  }
  return routes;
}
