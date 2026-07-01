/**
 * Vue single-file-component contract extraction (regex-based, no AST).
 *
 * Operates on the RAW full SFC text (the whole `.vue` file), not the script
 * stripped by ts-doc.extractVueScript. This is the P0-1 companion to the
 * discoverExports fallback in ts-export.ts: there we still register a `.vue`
 * file as a component even when `<script setup>` has no defineProps; here we
 * surface the structured props/emits/templateTags for that component.
 */

export interface VueContract {
  isComponent: boolean;
  props: string[];
  emits: string[];
  templateTags: string[];
}

const LIBRARY_TAG_PREFIXES = ["el-", "a-", "van-", "router-"];

// Native HTML element names to drop when collecting template tags.
const HTML_TAGS = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base",
  "bdi", "bdo", "blockquote", "body", "br", "button", "canvas", "caption",
  "cite", "code", "col", "colgroup", "data", "datalist", "dd", "del", "details",
  "dfn", "dialog", "div", "dl", "dt", "em", "embed", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head",
  "header", "hgroup", "hr", "html", "i", "iframe", "img", "input", "ins", "kbd",
  "label", "legend", "li", "link", "main", "map", "mark", "menu", "meta", "nav",
  "noscript", "object", "ol", "optgroup", "option", "output", "p", "picture",
  "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "script", "section",
  "select", "slot", "small", "source", "span", "strong", "style", "sub",
  "summary", "sup", "svg", "table", "tbody", "td", "template", "textarea",
  "tfoot", "th", "thead", "time", "title", "tr", "track", "u", "ul", "var",
  "video", "wbr",
]);

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPascalCaseTag(tag: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(tag);
}

function isLibraryPrefixedTag(tag: string): boolean {
  const lower = tag.toLowerCase();
  return LIBRARY_TAG_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Result of captureBalanced: the inner text and the index of the closing char. */
interface BalancedBlock {
  inner: string;
  end: number;
}

/**
 * Returns the inner text between a balanced open/close pair, starting at
 * `src[startIdx]` which must equal `open`. Tracks string literals and escapes
 * so braces inside strings don't affect nesting.
 */
function captureBalanced(src: string, open: string, close: string, startIdx: number): BalancedBlock | null {
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
 * Collects the top-level keys of an object/interface literal body (the text
 * between its outer braces). Skips quoted keys, index signatures and nested
 * members so e.g. `bar: { type: String }` yields `bar` but not `type`. Handles
 * optional `?:` markers so `visible?: boolean` yields `visible`.
 */
function topLevelKeys(inner: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = 0;
  let inStr: string | null = null;
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
    if (depth === 0 && /[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < inner.length && /[A-Za-z0-9_$]/.test(inner[j]!)) j++;
      let k = j;
      while (k < inner.length && /\s/.test(inner[k]!)) k++;
      if (inner[k] === "?") {
        k++;
        while (k < inner.length && /\s/.test(inner[k]!)) k++;
      }
      if (inner[k] === ":") pushUnique(keys, inner.slice(i, j));
      i = j;
      continue;
    }
    i++;
  }
  return keys;
}

function keysFromBalancedBraces(src: string, braceIdx: number): string[] {
  const block = captureBalanced(src, "{", "}", braceIdx);
  return block ? topLevelKeys(block.inner) : [];
}

function captureScriptBlock(rawSfc: string): string {
  const match = rawSfc.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  return match?.[1] ?? "";
}

/** Extracts type/interface keys when defineProps references a type alias. */
function resolveTypeAliasKeys(script: string, name: string): string[] {
  const keys: string[] = [];
  const interfaceRe = new RegExp(
    "\\binterface\\s+" + escapeRegExp(name) + "\\s*(?:extends[^{]*)?\\{",
    "g"
  );
  for (const match of script.matchAll(interfaceRe)) {
    const braceIdx = script.indexOf("{", match.index ?? 0);
    if (braceIdx >= 0) for (const k of keysFromBalancedBraces(script, braceIdx)) pushUnique(keys, k);
  }
  const typeRe = new RegExp("\\btype\\s+" + escapeRegExp(name) + "\\s*=\\s*\\{", "g");
  for (const match of script.matchAll(typeRe)) {
    const braceIdx = script.indexOf("{", match.index ?? 0);
    if (braceIdx >= 0) for (const k of keysFromBalancedBraces(script, braceIdx)) pushUnique(keys, k);
  }
  return keys;
}

function extractProps(script: string): string[] {
  const keys: string[] = [];

  // 1. defineProps<{ ... }>() / defineProps<TProps>() / withDefaults(defineProps<...>(), ...)
  for (const match of script.matchAll(/\bdefineProps\s*</g)) {
    const lt = script.indexOf("<", match.index ?? 0);
    const angle = captureBalanced(script, "<", ">", lt);
    if (!angle) continue;
    const braceIdx = angle.inner.indexOf("{", 0);
    if (braceIdx >= 0) {
      for (const k of keysFromBalancedBraces(angle.inner, braceIdx)) pushUnique(keys, k);
    } else {
      const alias = angle.inner.trim().match(/^[A-Za-z_$][\w$]*/);
      if (alias) for (const k of resolveTypeAliasKeys(script, alias[0])) pushUnique(keys, k);
    }
  }

  // 2. defineProps({ ... }) runtime object
  for (const match of script.matchAll(/\bdefineProps\s*\(/g)) {
    const parenIdx = script.indexOf("(", match.index ?? 0);
    const paren = captureBalanced(script, "(", ")", parenIdx);
    if (!paren) continue;
    const braceIdx = paren.inner.indexOf("{", 0);
    if (braceIdx >= 0) for (const k of keysFromBalancedBraces(paren.inner, braceIdx)) pushUnique(keys, k);
  }

  // 3. Options API props: { props: { foo: String, bar: { type: String } } }
  for (const match of script.matchAll(/\bprops\s*:\s*\{/g)) {
    const braceIdx = script.indexOf("{", match.index ?? 0);
    for (const k of keysFromBalancedBraces(script, braceIdx)) pushUnique(keys, k);
  }

  // 4. defineModel("x") / defineModel<string>("x")
  for (const match of script.matchAll(/\bdefineModel\b[^"']*["']([A-Za-z_$][\w$]*)["']/g)) {
    pushUnique(keys, match[1]!);
  }

  return keys;
}

function quotedNames(span: string): string[] {
  const names: string[] = [];
  for (const match of span.matchAll(/["']([A-Za-z_$][\w$-]*)["']/g)) {
    pushUnique(names, match[1]!);
  }
  return names;
}

function extractEmits(script: string): string[] {
  const emits: string[] = [];

  // defineEmits<...>(...) / defineEmits([...]) / defineEmits<{ (e: "x") => void }>()
  for (const match of script.matchAll(/\bdefineEmits\b/g)) {
    let i = (match.index ?? 0) + match[0].length;
    while (i < script.length && /\s/.test(script[i]!)) i++;
    let span = "";
    if (script[i] === "<") {
      const angle = captureBalanced(script, "<", ">", i);
      if (angle) {
        span += angle.inner + "\n";
        i = angle.end + 1;
      }
    }
    while (i < script.length && /\s/.test(script[i]!)) i++;
    if (script[i] === "(") {
      const paren = captureBalanced(script, "(", ")", i);
      if (paren) span += paren.inner + "\n";
    }
    for (const name of quotedNames(span)) pushUnique(emits, name);
  }

  // Options API emits: ["x", "y"] or emits: { x: ... }
  for (const match of script.matchAll(/\bemits\s*:\s*/g)) {
    const i = (match.index ?? 0) + match[0].length;
    if (script[i] === "[") {
      const arr = captureBalanced(script, "[", "]", i);
      if (arr) for (const name of quotedNames(arr.inner)) pushUnique(emits, name);
    } else if (script[i] === "{") {
      const obj = captureBalanced(script, "{", "}", i);
      if (obj) for (const name of quotedNames(obj.inner)) pushUnique(emits, name);
    }
  }

 // this.$emit("x") / ctx.emit("x")
  for (const match of script.matchAll(/[\.$]emit\s*\(\s*["']([A-Za-z_$][\w$]*)["']/g)) {
    pushUnique(emits, match[1]!);
  }

  return emits;
}

function extractTemplateTags(rawSfc: string): string[] {
  const tags = new Set<string>();
  const template = rawSfc.match(/<template[^>]*>([\s\S]*?)<\/template>/i);
  if (!template) return [];
  for (const match of template[1]!.matchAll(/<([A-Za-z][\w-]*)/g)) {
    const tag = match[1]!;
    if (HTML_TAGS.has(tag.toLowerCase())) continue;
    if (isPascalCaseTag(tag) || isLibraryPrefixedTag(tag)) tags.add(tag);
  }
  return [...tags].sort();
}

export function extractVueContract(rawSfc: string): VueContract | null {
  if (!rawSfc || !rawSfc.trim()) return null;

  const script = captureScriptBlock(rawSfc);
  const hasTemplate = /<template\b/i.test(rawSfc);
  const hasScript = /<script\b/i.test(rawSfc);

  return {
    isComponent: hasTemplate || hasScript || rawSfc.trim().length > 0,
    props: extractProps(script),
    emits: extractEmits(script),
    templateTags: extractTemplateTags(rawSfc),
  };
}
