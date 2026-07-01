/**
 * Store contract extraction (regex-based, no AST).
 *
 * Detects Pinia (`defineStore`) and Vuex (`new Vuex.Store`, Vuex 4
 * `createStore`) store definitions and lifts the state/getters/actions key
 * sets into StoreContract records (spec 3.3: "每 store 一卡"). A file may hold
 * several stores, so extractStores returns an array. Mirrors the style of
 * frontend-api.ts / frontend-router.ts: pure functions, never throw, empty
 * array when nothing is found.
 */

import type { StoreContract } from "../types.js";

// Trigger patterns. Non-global so .test is safe without lastIndex bookkeeping.
const PINIA_DEFINE_STORE_RE = /\bdefineStore\s*\(/;
const VUEX_STORE_RE = /\bnew\s+Vuex\.Store\s*\(/;
const VUEX_CREATE_STORE_RE = /\bcreateStore\s*\(/;

/** Reactive primitives treated as state in a setup store. */
const STATE_FACTORIES =
  "(?:ref|reactive|shallowRef|shallowReactive|readonly|shallowReadonly|toRef|toRefs|customRef)";

/** True when the file declares a Pinia or Vuex store. */
export function isStoreFile(content: string): boolean {
  return (
    PINIA_DEFINE_STORE_RE.test(content) ||
    VUEX_STORE_RE.test(content) ||
    VUEX_CREATE_STORE_RE.test(content)
  );
}

/** Escapes a string so it can be spliced into a RegExp literally. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns the inner text between a balanced open/close pair, starting at
 * `src[startIdx]` which must equal `open`. Tracks string literals and escapes
 * so braces/parens inside strings don't affect nesting. Same approach used by
 * frontend-router.ts.
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

/** Splits a string on commas that sit at brace/bracket/paren depth 0. */
function splitTopLevelCommas(src: string): string[] {
  const segs: string[] = [];
  let depth = 0;
  let i = 0;
  let inStr: string | null = null;
  let segStart = 0;
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
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth > 0) depth--;
    } else if (ch === "," && depth === 0) {
      segs.push(src.slice(segStart, i));
      segStart = i + 1;
    }
    i++;
  }
  segs.push(src.slice(segStart));
  return segs;
}

/**
 * Reads the identifier key at the start of an object member segment. Supports
 * shorthand (`count`), `key: value`, and method shorthand (`increment()`).
 */
function memberKey(seg: string): string | null {
  const m = seg.trim().match(/^([A-Za-z_$][\w$]*)(?:\s*[(:]|$)/);
  return m ? m[1]! : null;
}

/** Key identifiers of an object literal body (its inner text). */
function objectKeys(objInner: string): string[] {
  const keys: string[] = [];
  for (const seg of splitTopLevelCommas(objInner)) {
    const key = memberKey(seg);
    if (key) keys.push(key);
  }
  return keys;
}

/** Unwraps a leading string literal ("id" / 'id' / `id`) from a fragment. */
function extractStringLit(arg: string): string | undefined {
  const m = arg.trim().match(/^(['"`])([\s\S]*?)\1/);
  return m?.[2];
}

/**
 * Finds the object literal returned by a setup function body. Supports the
 * explicit `return { ... }` form and the paren-wrapped `return ({ ... })`
 * form. Returns the object's inner text, or null when no object return exists.
 */
function findReturnObject(body: string): string | null {
  let depth = 0;
  let i = 0;
  let inStr: string | null = null;
  const kw = /^return\b/;
  while (i < body.length) {
    const ch = body[i]!;
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
    if (depth === 0 && ch === "r") {
      const m = kw.exec(body.slice(i));
      if (m) {
        let j = i + m[0].length;
        while (j < body.length && /\s/.test(body[j]!)) j++;
        if (body[j] === "(") {
          // return ({ ... }) — unwrap the paren then the object inside it.
          const paren = captureBalanced(body, "(", ")", j);
          if (paren) {
            const braceIdx = paren.inner.indexOf("{");
            if (braceIdx >= 0) {
              const blk = captureBalanced(paren.inner, "{", "}", braceIdx);
              if (blk) return blk.inner;
            }
          }
        } else if (body[j] === "{") {
          const blk = captureBalanced(body, "{", "}", j);
          if (blk) return blk.inner;
        }
        // A return that is not an object literal: stop searching.
        return null;
      }
    }
    i++;
  }
  return null;
}

/**
 * Classifies a setup-store return key by searching the setup body for its
 * declaration: function declaration or arrow/function assignment -> action,
 * `computed(...)` assignment -> getter, reactive primitive (ref/reactive/...)
 * assignment -> state. Returns null when no declaration is found (caller then
 * inspects the return member's own value).
 */
function classifyByDeclaration(
  body: string,
  key: string
): "state" | "getters" | "actions" | null {
  const k = escapeRe(key);
  if (new RegExp(`\\bfunction\\s+${k}\\s*\\(`).test(body)) return "actions";
  if (
    new RegExp(`\\b(?:const|let|var)\\s+${k}\\s*=\\s*(?:async\\s+)?computed\\s*\\(`).test(
      body
    )
  ) {
    return "getters";
  }
  if (
    new RegExp(
      `\\b(?:const|let|var)\\s+${k}\\s*=\\s*(?:async\\s+)?${STATE_FACTORIES}\\s*\\(`
    ).test(body)
  ) {
    return "state";
  }
  if (
    new RegExp(
      `\\b(?:const|let|var)\\s+${k}\\s*=\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)`
    ).test(body)
  ) {
    return "actions";
  }
  return null;
}

/**
 * Fallback classifier that inspects a return member's own value: method
 * shorthand or an arrow/function value -> action, `computed(` -> getter,
 * reactive primitive -> state. Shorthand (no value) and anything unrecognized
 * default to state, matching the "ambiguous keys go to state" rule.
 */
function classifyObjectMember(seg: string): "state" | "getters" | "actions" {
  const s = seg.trim();
  if (/^(?:async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.test(s)) return "actions";
  const colon = s.indexOf(":");
  if (colon < 0) return "state";
  const val = s.slice(colon + 1).trim();
  if (/\b(?:async\s+)?computed\s*\(/.test(val)) return "getters";
  if (new RegExp(`\\b${STATE_FACTORIES}\\s*\\(`).test(val)) return "state";
  if (/^(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(val)) {
    return "actions";
  }
  return "state";
}

/** Parses a Pinia setup function body into {state, getters, actions}. */
function parseSetupStore(body: string): {
  state: string[];
  getters: string[];
  actions: string[];
} {
  const state: string[] = [];
  const getters: string[] = [];
  const actions: string[] = [];
  const retInner = findReturnObject(body);
  if (!retInner) return { state, getters, actions };
  for (const seg of splitTopLevelCommas(retInner)) {
    const key = memberKey(seg);
    if (!key) continue;
    const declared = classifyByDeclaration(body, key);
    const bucket = declared ?? classifyObjectMember(seg);
    if (bucket === "getters") getters.push(key);
    else if (bucket === "actions") actions.push(key);
    else state.push(key);
  }
  return { state, getters, actions };
}

/** Index of the value start (right after the colon) for a `<key>:` pair. */
function findKeyColon(body: string, key: string): number {
  const re = new RegExp(`\\b${escapeRe(key)}\\s*:`);
  const m = re.exec(body);
  return m ? m.index + m[0].length : -1;
}

/** Key set of a `key: { ... }` object literal inside a store options body. */
function objectKeysForKey(body: string, key: string): string[] {
  const idx = findKeyColon(body, key);
  if (idx < 0) return [];
  let i = idx;
  while (i < body.length && /\s/.test(body[i]!)) i++;
  if (body[i] !== "{") return [];
  const blk = captureBalanced(body, "{", "}", i);
  return blk ? objectKeys(blk.inner) : [];
}

/**
 * Extracts the object returned by a state factory, starting at `from` (the
 * position right after `state:` or `state(`). Handles arrow factories,
 * `() => ({ ... })` implicit returns, `() => { return { ... } }` blocks, and
 * `function () { ... }`. Returns the returned object's inner text or null.
 */
function findStateObject(src: string, from: number): string | null {
  let i = from;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  if (src[i] === "(") {
    const params = captureBalanced(src, "(", ")", i);
    if (!params) return null;
    const arrowIdx = src.indexOf("=>", params.end);
    if (arrowIdx < 0) return null;
    let j = arrowIdx + 2;
    while (j < src.length && /\s/.test(src[j]!)) j++;
    if (src[j] === "(") {
      const paren = captureBalanced(src, "(", ")", j);
      if (!paren) return null;
      const braceIdx = paren.inner.indexOf("{");
      if (braceIdx < 0) return null;
      const blk = captureBalanced(paren.inner, "{", "}", braceIdx);
      return blk ? blk.inner : null;
    }
    if (src[j] === "{") {
      const blk = captureBalanced(src, "{", "}", j);
      return blk ? findReturnObject(blk.inner) : null;
    }
    return null;
  }
  if (src.slice(i).startsWith("function")) {
    const braceIdx = src.indexOf("{", i);
    if (braceIdx < 0) return null;
    const blk = captureBalanced(src, "{", "}", braceIdx);
    return blk ? findReturnObject(blk.inner) : null;
  }
  return null;
}

/**
 * State keys for an options/Vuex store: a direct object literal
 * (`state: { ... }`, Vuex 3) or a factory (`state: () => ({ ... })`).
 */
function stateKeysFor(body: string): string[] {
  const m = /\bstate\b\s*(?::|\()/.exec(body);
  if (!m) return [];
  const from = m.index + m[0].length;
  let i = from;
  while (i < body.length && /\s/.test(body[i]!)) i++;
  if (body[i] === "{") {
    const blk = captureBalanced(body, "{", "}", i);
    return blk ? objectKeys(blk.inner) : [];
  }
  const obj = findStateObject(body, from);
  return obj ? objectKeys(obj) : [];
}

/** Parses a Pinia options store (`{ state, getters, actions }`) body. */
function parseOptionsStore(optionsBody: string): {
  state: string[];
  getters: string[];
  actions: string[];
} {
  return {
    state: stateKeysFor(optionsBody),
    getters: objectKeysForKey(optionsBody, "getters"),
    actions: objectKeysForKey(optionsBody, "actions"),
  };
}

/**
 * Parses a Vuex options body. `state` may be a direct object (Vuex 3) or a
 * factory (Vuex 4). Per the StoreContract shape (state/getters/actions only),
 * `mutations` keys fold into `actions` alongside regular actions.
 */
function parseVuexStore(optionsBody: string): {
  state: string[];
  getters: string[];
  actions: string[];
} {
  const actions = objectKeysForKey(optionsBody, "actions");
  const mutations = objectKeysForKey(optionsBody, "mutations");
  return {
    state: stateKeysFor(optionsBody),
    getters: objectKeysForKey(optionsBody, "getters"),
    actions: [...actions, ...mutations],
  };
}

/**
 * Parses the second argument to `defineStore` — a setup function (arrow or
 * function declaration) or an options object — into its key buckets.
 */
function parseDefineStoreBody(secondArg: string): {
  state: string[];
  getters: string[];
  actions: string[];
} | null {
  const raw = secondArg.trimStart();
  if (raw.startsWith("{")) {
    const blk = captureBalanced(raw, "{", "}", 0);
    return blk ? parseOptionsStore(blk.inner) : null;
  }
  // setup function: arrow or function declaration
  let i = 0;
  while (i < raw.length && /\s/.test(raw[i]!)) i++;
  if (raw[i] === "(") {
    const params = captureBalanced(raw, "(", ")", i);
    if (!params) return null;
    const arrowIdx = raw.indexOf("=>", params.end);
    if (arrowIdx < 0) return null;
    let j = arrowIdx + 2;
    while (j < raw.length && /\s/.test(raw[j]!)) j++;
    if (raw[j] === "{") {
      const blk = captureBalanced(raw, "{", "}", j);
      return blk ? parseSetupStore(blk.inner) : null;
    }
    if (raw[j] === "(") {
      // implicit-return setup: () => ({ ... })
      const paren = captureBalanced(raw, "(", ")", j);
      if (!paren) return null;
      const braceIdx = paren.inner.indexOf("{");
      if (braceIdx < 0) return null;
      const blk = captureBalanced(paren.inner, "{", "}", braceIdx);
      return blk ? parseSetupStore(`return { ${blk.inner} };`) : null;
    }
    return null;
  }
  if (raw.slice(i).startsWith("function")) {
    const braceIdx = raw.indexOf("{", i);
    if (braceIdx < 0) return null;
    const blk = captureBalanced(raw, "{", "}", braceIdx);
    return blk ? parseSetupStore(blk.inner) : null;
  }
  return null;
}

/**
 * Store name fallback: the first `export const X = <store-ctor>(...)`, else the
 * file basename without extension (mirrors frontend-api.ts).
 */
function inferStoreName(content: string, filePath: string): string {
  const nameMatch = content.match(
    /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:defineStore|createStore|new\s+Vuex\.Store)/
  );
  if (nameMatch?.[1]) return nameMatch[1];
  const base = filePath.replace(/[\\/]+/g, "/").split("/").pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Extracts one StoreContract per `defineStore` / `new Vuex.Store` /
 * `createStore` definition in the file. Pinia stores are always emitted (a
 * store with no recognized members yields empty arrays, never null); Vuex
 * stores are emitted only when at least one key bucket is non-empty, so a
 * Redux-style `createStore(reducer)` produces no noise. Returns [] when no
 * store definition is found.
 */
export function extractStores(
  content: string,
  filePath: string
): StoreContract[] {
  const stores: StoreContract[] = [];

  // Pinia: defineStore(id, setup | options)
  for (const m of content.matchAll(/\bdefineStore\s*\(/g)) {
    const parenStart = (m.index ?? 0) + m[0].length - 1; // index of '('
    const args = captureBalanced(content, "(", ")", parenStart);
    if (!args) continue;
    const parts = splitTopLevelCommas(args.inner);
    const storeId = parts[0] ? extractStringLit(parts[0]) : undefined;
    if (parts[1] === undefined) continue;
    const parsed = parseDefineStoreBody(parts[1]);
    if (!parsed) continue;
    const name = storeId ?? inferStoreName(content, filePath);
    const contract: StoreContract = {
      name,
      file: filePath,
      description: "",
      state: parsed.state,
      getters: parsed.getters,
      actions: parsed.actions,
    };
    if (storeId) contract.storeId = storeId;
    stores.push(contract);
  }

  // Vuex 3 (new Vuex.Store) and Vuex 4 (createStore)
  for (const m of content.matchAll(/\b(?:new\s+Vuex\.Store|createStore)\s*\(/g)) {
    const parenStart = (m.index ?? 0) + m[0].length - 1; // index of '('
    const args = captureBalanced(content, "(", ")", parenStart);
    if (!args) continue;
    const parsed = parseVuexStore(args.inner);
    // Skip empty results (e.g. Redux createStore(reducer)) to avoid noise.
    if (
      parsed.state.length === 0 &&
      parsed.getters.length === 0 &&
      parsed.actions.length === 0
    ) {
      continue;
    }
    stores.push({
      name: inferStoreName(content, filePath),
      file: filePath,
      description: "",
      state: parsed.state,
      getters: parsed.getters,
      actions: parsed.actions,
    });
  }

  return stores;
}
