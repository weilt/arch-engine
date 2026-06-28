/**
 * API-client contract extraction (regex-based, no AST).
 *
 * Detects HTTP client usage (an axios import or a `request` wrapper) and
 * collects the fluent `.method('/path')` calls into a single ApiClientContract
 * per file (spec 3.3: "每文件一卡"). Template-literal paths such as
 * `/user/${id}` are preserved verbatim so the backend linker can match them
 * later. Mirrors the style of ts-doc.ts / frontend-vue-contract.ts.
 */

import type { ApiClientContract } from "../types.js";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const METHOD_MAP: Record<string, HttpMethod> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  delete: "DELETE",
  patch: "PATCH",
};

/**
 * Recognizes an HTTP client import:
 *  - `import ... from '<path containing request>'` (lenient: any wrapper path,
 *    e.g. `@/utils/request`, `~/request`),
 *  - `from 'axios'` / `from "axios"` (default axios import),
 *  - `require('axios')` / `require("axios")`.
 *
 * Non-global so `.test` is safe without lastIndex bookkeeping.
 */
const HTTP_CLIENT_IMPORT_RE =
  /\bimport\b[\s\S]*?from\s*['"][^'"]*request[^'"]*['"]|from\s*['"]axios['"]|require\s*\(\s*['"]axios['"]\s*\)/;

/** Non-global test for the presence of any fluent HTTP method call. */
const METHOD_CALL_TEST_RE = /\.(?:get|post|put|delete|patch)\s*\(/;

/** Global scan for fluent HTTP method calls (captures the method word). */
const METHOD_CALL_RE = /\.(get|post|put|delete|patch)\s*\(/g;

/**
 * Reads the first argument starting at `fromIdx` (the position right after the
 * opening paren of a method call). Returns the literal path content for a
 * string/template literal (template interpolation like `${id}` is kept as-is),
 * the placeholder "<dynamic>" when the first arg is not a literal (a variable
 * or object), or null if it cannot be parsed. The method word is anchored on a
 * following `(`, so `.deletedFoo(` is never confused with `.delete(`.
 */
function captureFirstPathArg(src: string, fromIdx: number): string | null {
  let i = fromIdx;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  if (i >= src.length) return null;
  const quote = src[i]!;
  if (quote === "'" || quote === '"' || quote === "`") {
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === "\\") {
        j += 2;
        continue;
      }
      if (src[j] === quote) break;
      j++;
    }
    if (j >= src.length) return null;
    return src.slice(i + 1, j);
  }
  // First arg is a variable/object, not a path literal.
  return "<dynamic>";
}

/**
 * Client name heuristic: the first `export const <ident>` in the file, else the
 * file basename without extension.
 */
function inferClientName(content: string, filePath: string): string {
  const nameMatch = content.match(/\bexport\s+const\s+([A-Za-z_$][\w$]*)/);
  if (nameMatch?.[1]) return nameMatch[1];
  const base = filePath.replace(/[\\/]+/g, "/").split("/").pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** True when the file imports an HTTP client AND makes at least one call. */
export function isApiClientFile(content: string): boolean {
  if (!HTTP_CLIENT_IMPORT_RE.test(content)) return false;
  return METHOD_CALL_TEST_RE.test(content);
}

/**
 * Extracts a single ApiClientContract (per spec "每文件一卡") from the fluent
 * method calls in the file. Template paths are kept verbatim. Duplicate
 * (method, path) pairs within the file are de-duplicated. Returns an empty
 * array when no endpoints are found, so callers never emit an empty card.
 */
export function extractApiClients(
  content: string,
  filePath: string
): ApiClientContract[] {
  const endpoints: ApiClientContract["endpoints"] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(METHOD_CALL_RE)) {
    const method = METHOD_MAP[match[1]!.toLowerCase()];
    if (!method) continue;
    const argStart = (match.index ?? 0) + match[0].length;
    const path = captureFirstPathArg(content, argStart) ?? "<dynamic>";
    const key = `${method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    endpoints.push({ method, path });
  }

  if (endpoints.length === 0) return [];

  return [
    {
      name: inferClientName(content, filePath),
      file: filePath,
      description: "",
      endpoints,
    },
  ];
}
