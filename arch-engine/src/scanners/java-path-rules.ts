import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import YAML from "yaml";
import type { ArchConfig, ControllerPathPrefixConfig } from "../types.js";
import {
  readAutoConfigurationImports,
  readSpringFactoriesAutoConfiguration,
} from "./java-starter.js";

/** One controller-package → URL prefix rule (Spring PathMatch / WebMvcRegistrations). */
export interface ControllerPathPrefixRule {
  prefix: string;
  /** Ant-style pattern with `.` as separator, e.g. `**.controller.admin.**` */
  controllerPattern: string;
  source: string;
  /** When manual overrides auto, records the overridden auto rule source. */
  overrides?: string | null;
  /** Relative path to the Java file that produced an auto-discovered rule. */
  file?: string;
}

export interface ResolvedJavaPathRules {
  contextPath: string;
  controllerPrefixes: ControllerPathPrefixRule[];
  /** high = WebProperties-style rules; medium = yml only; low = partial / fallback */
  confidence: "high" | "medium" | "low";
  sources: string[];
}

const WEB_MVC_REGISTRATIONS_RE = /WebMvcRegistrations/;
const WEB_MVC_CONFIGURER_RE = /implements\s+WebMvcConfigurer/;
const CONFIGURER_PATH_SIGNAL_RE =
  /(?:addPathPrefix|pathPrefixes\.put|configurePathMatch)/;
const CONFIG_PROPERTIES_RE =
  /@ConfigurationProperties\s*\(\s*prefix\s*=\s*["']([^"']+)["']/;

/** `private Api adminApi = new Api("/admin-api", "**.controller.admin.**");` */
const API_FIELD_DEFAULT_RE =
  /(?:private|protected)\s+Api\s+(\w+)\s*=\s*new\s+Api\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;

/** `pathPrefixes.put("/admin-api",` or `addPathPrefix("/admin-api",` */
const INLINE_PREFIX_RE =
  /(?:pathPrefixes\.put|addPathPrefix)\s*\(\s*["']([^"']+)["']/g;

/** `webProperties.getAdminApi()` → field name adminApi */
const GETTER_TO_FIELD_RE = /(\w+Properties)\.get(\w+)\(\)/g;

function normalizeUrlPath(...segments: string[]): string {
  const joined = segments
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/");
  if (!joined.startsWith("/")) return `/${joined}`;
  return joined.replace(/\/$/, "") || "/";
}

/**
 * Approximate Spring AntPathMatcher (`.` separator) for Java package names.
 * Handles Yudao-style `**.controller.admin.**` including leaf packages without a trailing segment.
 */
export function antPackageMatch(pattern: string, packageName: string): boolean {
  if (pattern.startsWith("**.") && pattern.endsWith(".**")) {
    const core = pattern.slice(3, -3);
    if (core && !core.includes("*")) {
      return (
        packageName === core ||
        packageName.endsWith(`.${core}`) ||
        packageName.includes(`.${core}.`)
      );
    }
  }

  const parts = pattern.split(".");
  let re = "^";
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    if (i > 0) re += "\\.";
    if (seg === "**") {
      re += "(?:[^.]*\\.)*[^.]*";
    } else if (seg === "*") {
      re += "[^.]*";
    } else {
      re += seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  re += "$";
  return new RegExp(re).test(packageName);
}

export function prefixForControllerPackage(
  rules: ResolvedJavaPathRules,
  packageName: string | undefined
): string {
  if (!packageName) return rules.contextPath;
  for (const rule of rules.controllerPrefixes) {
    if (antPackageMatch(rule.controllerPattern, packageName)) {
      return normalizeUrlPath(rules.contextPath, rule.prefix);
    }
  }
  return rules.contextPath;
}

export function applyPathRulesToEndpointPath(
  rules: ResolvedJavaPathRules,
  packageName: string | undefined,
  annotationPath: string
): string {
  const base = prefixForControllerPackage(rules, packageName);
  const rel = annotationPath.startsWith("/") ? annotationPath : `/${annotationPath}`;
  if (base === "/" || base === "") return normalizeUrlPath(rel);
  return normalizeUrlPath(base, rel);
}

function parseApiFieldDefaults(content: string): Map<string, { prefix: string; pattern: string }> {
  const map = new Map<string, { prefix: string; pattern: string }>();
  for (const m of content.matchAll(API_FIELD_DEFAULT_RE)) {
    map.set(m[1]!, { prefix: m[2]!, pattern: m[3]! });
  }
  return map;
}

function fieldNameFromGetter(getter: string): string {
  const name = getter.charAt(0).toLowerCase() + getter.slice(1);
  return name;
}

function findReferencedPropertiesClass(webMvcFileContent: string): string | null {
  const enableMatch = webMvcFileContent.match(
    /@EnableConfigurationProperties\s*\(\s*(\w+)\.class\s*\)/
  );
  if (enableMatch) return enableMatch[1]!;

  const paramMatch = webMvcFileContent.match(
    /WebMvcRegistrations\s+\w+\s*\(\s*(\w+)\s+\w+\s*\)/
  );
  if (paramMatch) return paramMatch[1]!;

  if (webMvcFileContent.includes("WebProperties")) return "WebProperties";

  return null;
}

async function findJavaFileByClassName(
  roots: string[],
  className: string
): Promise<string | null> {
  for (const root of roots) {
    const hits = await fg.glob(`**/${className}.java`, {
      cwd: root,
      absolute: true,
      ignore: ["**/target/**", "**/node_modules/**"],
    });
    if (hits[0]) return hits[0];
  }
  return null;
}

async function findJavaFileByFqcn(
  roots: string[],
  fqcn: string
): Promise<string | null> {
  const simpleName = fqcn.split(".").pop();
  const packageName = fqcn.slice(0, fqcn.lastIndexOf("."));
  if (!simpleName) return null;

  const relPath = `${packageName.replace(/\./g, "/")}/${simpleName}.java`;
  for (const root of roots) {
    const standard = path.join(root, "src/main/java", relPath);
    try {
      await fs.access(standard);
      return standard;
    } catch {
      /* try broader search */
    }
  }

  for (const root of roots) {
    const hits = await fg.glob(`**/${simpleName}.java`, {
      cwd: root,
      absolute: true,
      ignore: ["**/target/**", "**/node_modules/**"],
    });
    for (const hit of hits) {
      if (extractJavaPackage(await fs.readFile(hit, "utf-8")) === packageName) {
        return hit;
      }
    }
  }
  return null;
}

async function findMavenModuleDirs(roots: string[]): Promise<string[]> {
  const dirs = new Set<string>();
  for (const root of roots) {
    const poms = await fg.glob("**/pom.xml", {
      cwd: root,
      absolute: true,
      ignore: ["**/target/**", "**/node_modules/**"],
    });
    for (const pom of poms) {
      dirs.add(path.dirname(pom));
    }
  }
  return [...dirs];
}

async function globJavaFiles(roots: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) {
    const hits = await fg.glob("**/*.java", {
      cwd: root,
      absolute: true,
      ignore: ["**/target/**", "**/node_modules/**"],
    });
    files.push(...hits);
  }
  return files;
}

function classNameFromJavaFile(file: string): string {
  return path.basename(file, ".java");
}

function isWebPropertiesDirectCandidate(content: string): boolean {
  return CONFIG_PROPERTIES_RE.test(content) && /new\s+Api\s*\(/.test(content);
}

async function collectRulesFromPropertiesFile(
  file: string,
  content: string,
  projectRoot: string
): Promise<ControllerPathPrefixRule[]> {
  const className = classNameFromJavaFile(file);
  const cpMatch = content.match(CONFIG_PROPERTIES_RE);
  const configPrefix = cpMatch?.[1];

  let rules = rulesFromPropertiesJava(content, className, file);
  if (configPrefix) {
    const ymlFlat = await loadYamlConfigKeys(projectRoot, configPrefix);
    rules = applyYmlOverridesToRules(rules, ymlFlat, configPrefix);
  }
  return rules;
}

async function applyDetectorB(
  file: string,
  content: string,
  projectRoot: string,
  controllerPrefixes: ControllerPathPrefixRule[],
  sources: string[],
  confidence: ResolvedJavaPathRules["confidence"]
): Promise<{
  controllerPrefixes: ControllerPathPrefixRule[];
  sources: string[];
  confidence: ResolvedJavaPathRules["confidence"];
}> {
  if (!isWebPropertiesDirectCandidate(content)) {
    return { controllerPrefixes, sources, confidence };
  }

  const rules = await collectRulesFromPropertiesFile(file, content, projectRoot);
  if (rules.length === 0) {
    return { controllerPrefixes, sources, confidence };
  }

  const before = controllerPrefixes.length;
  const merged = mergeRulesByPattern(controllerPrefixes, rules);
  if (merged.length > before) {
    sources.push(file);
    if (confidence !== "high") {
      return { controllerPrefixes: merged, sources, confidence: "high" };
    }
    return { controllerPrefixes: merged, sources, confidence };
  }
  return { controllerPrefixes: merged, sources, confidence };
}

function applyDetectorC(
  file: string,
  content: string,
  controllerPrefixes: ControllerPathPrefixRule[],
  sources: string[],
  confidence: ResolvedJavaPathRules["confidence"]
): {
  controllerPrefixes: ControllerPathPrefixRule[];
  sources: string[];
  confidence: ResolvedJavaPathRules["confidence"];
} {
  if (!isWebMvcConfigurerCandidate(content)) {
    return { controllerPrefixes, sources, confidence };
  }

  const rules = rulesFromWebMvcConfigurer(content, file);
  if (rules.length === 0) {
    return { controllerPrefixes, sources, confidence };
  }

  const before = controllerPrefixes.length;
  const merged = mergeRulesByPattern(controllerPrefixes, rules);
  if (merged.length > before) {
    sources.push(file);
    const nextConfidence = confidence === "high" ? "high" : "medium";
    return { controllerPrefixes: merged, sources, confidence: nextConfidence };
  }
  return { controllerPrefixes: merged, sources, confidence };
}

function mergeRulesByPattern(
  existing: ControllerPathPrefixRule[],
  incoming: ControllerPathPrefixRule[]
): ControllerPathPrefixRule[] {
  const seen = new Set(
    existing.map((r) => normalizeControllerPattern(r.controllerPattern))
  );
  const merged = [...existing];
  for (const rule of incoming) {
    const key = normalizeControllerPattern(rule.controllerPattern);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(rule);
    }
  }
  return merged;
}

function parseYmlFlat(root: unknown, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!root || typeof root !== "object") return out;

  function walk(obj: Record<string, unknown>, keys: string[]) {
    for (const [k, v] of Object.entries(obj)) {
      const next = [...keys, k];
      const pathKey = next.join(".");
      if (typeof v === "string" || typeof v === "number") {
        if (pathKey.startsWith(prefix)) out[pathKey] = String(v);
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        walk(v as Record<string, unknown>, next);
      }
    }
  }
  walk(root as Record<string, unknown>, []);
  return out;
}

async function loadYamlApplicationFiles(
  projectRoot: string
): Promise<Record<string, string>[]> {
  const files = await fg.glob(
    ["**/application.yml", "**/application.yaml", "**/application-*.yml", "**/application-*.yaml"],
    {
      cwd: projectRoot,
      absolute: true,
      ignore: ["**/target/**", "**/node_modules/**"],
    }
  );

  const flats: Record<string, string>[] = [];
  for (const file of files.slice(0, 20)) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const doc = YAML.parse(raw) as unknown;
      flats.push(parseYmlFlat(doc, ""));
    } catch {
      /* skip invalid yaml */
    }
  }
  return flats;
}

async function loadYamlConfigKeys(
  projectRoot: string,
  configPrefix: string
): Promise<Record<string, string>> {
  const flats = await loadYamlApplicationFiles(projectRoot);
  const merged: Record<string, string> = {};
  for (const flat of flats) {
    for (const [key, value] of Object.entries(flat)) {
      if (key.startsWith(configPrefix)) merged[key] = value;
    }
  }
  return merged;
}

/** `base.web.admin-api.prefix` or `foo.web.admin-api.prefix` */
function isWebControllerPathYmlKey(key: string): boolean {
  if (!key.endsWith(".prefix")) return false;
  const base = key.slice(0, -".prefix".length);
  return /\.web\.[^.]+$/.test(base);
}

function rulesFromYmlOnly(
  ymlFlat: Record<string, string>
): ControllerPathPrefixRule[] {
  const rules: ControllerPathPrefixRule[] = [];
  const seen = new Set<string>();

  for (const [key, prefixValue] of Object.entries(ymlFlat)) {
    if (!isWebControllerPathYmlKey(key)) continue;
    const base = key.slice(0, -".prefix".length);
    const controllerPattern = ymlFlat[`${base}.controller`];
    if (!controllerPattern) continue;

    const normalized = normalizeControllerPattern(controllerPattern);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const prefix =
      prefixValue.startsWith("/") ? prefixValue : `/${prefixValue}`;
    rules.push({
      prefix,
      controllerPattern,
      source: `yml-only:${base}`,
    });
  }
  return rules;
}

function applyDetectorE(
  ymlFlats: Record<string, string>[],
  controllerPrefixes: ControllerPathPrefixRule[],
  sources: string[],
  confidence: ResolvedJavaPathRules["confidence"]
): {
  controllerPrefixes: ControllerPathPrefixRule[];
  sources: string[];
  confidence: ResolvedJavaPathRules["confidence"];
} {
  const mergedYml: Record<string, string> = {};
  for (const flat of ymlFlats) Object.assign(mergedYml, flat);

  const ymlOnly = rulesFromYmlOnly(mergedYml);
  if (ymlOnly.length === 0) {
    return { controllerPrefixes, sources, confidence };
  }

  const before = controllerPrefixes.length;
  const merged = mergeRulesByPattern(controllerPrefixes, ymlOnly);
  if (merged.length <= before) {
    return { controllerPrefixes: merged, sources, confidence };
  }

  sources.push("yml-only");
  const nextConfidence = confidence === "high" ? "high" : "medium";
  return { controllerPrefixes: merged, sources, confidence: nextConfidence };
}

function applyYmlOverridesToRules(
  rules: ControllerPathPrefixRule[],
  ymlFlat: Record<string, string>,
  configPrefix: string
): ControllerPathPrefixRule[] {
  const byField = new Map<string, ControllerPathPrefixRule>();
  for (const r of rules) {
    const fieldMatch = r.source.match(/field:(\w+)/);
    if (fieldMatch) byField.set(fieldMatch[1]!, r);
  }

  const updated: ControllerPathPrefixRule[] = [];
  for (const rule of rules) {
    const fieldMatch = rule.source.match(/field:(\w+)/);
    if (!fieldMatch) {
      updated.push(rule);
      continue;
    }
    const field = fieldMatch[1]!;
    const ymlSegment = field.endsWith("Api")
      ? `${field
          .slice(0, -3)
          .replace(/([A-Z])/g, "-$1")
          .toLowerCase()
          .replace(/^-/, "")}-api`
      : field.replace(/([A-Z])/g, "-$1").toLowerCase();
    const prefixKey = `${configPrefix}.${ymlSegment}.prefix`;
    const controllerKey = `${configPrefix}.${ymlSegment}.controller`;
    const altPrefixKey = `${configPrefix}.${field}.prefix`;
    const altControllerKey = `${configPrefix}.${field}.controller`;

    const prefix =
      ymlFlat[prefixKey] ?? ymlFlat[altPrefixKey] ?? rule.prefix;
    const controllerPattern =
      ymlFlat[controllerKey] ?? ymlFlat[altControllerKey] ?? rule.controllerPattern;

    updated.push({
      ...rule,
      prefix,
      controllerPattern,
      source: `${rule.source}+yml`,
    });
  }
  return updated;
}

async function resolveContextPath(projectRoot: string): Promise<string> {
  const yml = await loadYamlConfigKeys(projectRoot, "server");
  const ctx =
    yml["server.servlet.context-path"] ??
    yml["server.servlet.contextPath"] ??
    "";
  if (!ctx || ctx === "/") return "";
  return ctx.startsWith("/") ? ctx.replace(/\/$/, "") : `/${ctx}`.replace(/\/$/, "");
}

function rulesFromPropertiesJava(
  content: string,
  className: string,
  file: string
): ControllerPathPrefixRule[] {
  const defaults = parseApiFieldDefaults(content);
  const rules: ControllerPathPrefixRule[] = [];
  for (const [field, { prefix, pattern }] of defaults) {
    rules.push({
      prefix,
      controllerPattern: pattern,
      source: `${className}:field:${field}`,
    });
  }

  if (rules.length === 0) {
    const prefixOnly = [...content.matchAll(/["'](\/[\w-]+-api)["']/g)].map((m) => m[1]!);
    const unique = [...new Set(prefixOnly)];
    for (const p of unique) {
      if (p.includes("admin")) {
        rules.push({
          prefix: p,
          controllerPattern: "**.controller.admin.**",
          source: `${className}:heuristic`,
        });
      } else if (p.includes("app")) {
        rules.push({
          prefix: p,
          controllerPattern: "**.controller.app.**",
          source: `${className}:heuristic`,
        });
      } else if (p.includes("pc")) {
        rules.push({
          prefix: p,
          controllerPattern: "**.controller.pc.**",
          source: `${className}:heuristic`,
        });
      }
    }
  }

  return rules.map((r) => ({ ...r, source: `${file} ${r.source}` }));
}

function inferControllerPatternFromPrefix(prefix: string): string {
  if (prefix.includes("admin")) return "**.controller.admin.**";
  if (prefix.includes("app")) return "**.controller.app.**";
  if (prefix.includes("pc")) return "**.controller.pc.**";
  return "**.controller.**";
}

function inferControllerPatternFromSecondArg(secondArg: string): string | null {
  const strLit = secondArg.match(/^["']([^"']+)["']/);
  if (strLit) return strLit[1]!;

  if (/controller\.admin/.test(secondArg)) return "**.controller.admin.**";
  if (/controller\.app/.test(secondArg)) return "**.controller.app.**";
  if (/controller\.pc/.test(secondArg)) return "**.controller.pc.**";

  return null;
}

function parseSecondArgAfterPrefix(content: string, matchEnd: number): string | null {
  const after = content.slice(matchEnd);
  const commaMatch = after.match(/^\s*,\s*/);
  if (!commaMatch) return null;

  const rest = after.slice(commaMatch[0].length);
  const closeParen = rest.indexOf(")");
  const expr = closeParen >= 0 ? rest.slice(0, closeParen) : rest.slice(0, 200);
  return inferControllerPatternFromSecondArg(expr);
}

function isWebMvcConfigurerCandidate(content: string): boolean {
  return (
    WEB_MVC_CONFIGURER_RE.test(content) && CONFIGURER_PATH_SIGNAL_RE.test(content)
  );
}

function rulesFromInlineWebMvc(content: string, file: string): ControllerPathPrefixRule[] {
  const rules: ControllerPathPrefixRule[] = [];
  for (const m of content.matchAll(INLINE_PREFIX_RE)) {
    const prefix = m[1]!;
    const pattern = inferControllerPatternFromPrefix(prefix);
    rules.push({ prefix, controllerPattern: pattern, source: `${file}:inline` });
  }
  return rules;
}

function rulesFromWebMvcConfigurer(
  content: string,
  file: string
): ControllerPathPrefixRule[] {
  const rules: ControllerPathPrefixRule[] = [];
  const seen = new Set<string>();

  for (const m of content.matchAll(INLINE_PREFIX_RE)) {
    const prefix = m[1]!;
    const matchEnd = (m.index ?? 0) + m[0].length;
    const pattern =
      parseSecondArgAfterPrefix(content, matchEnd) ??
      inferControllerPatternFromPrefix(prefix);
    const key = `${prefix}|${pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({
      prefix,
      controllerPattern: pattern,
      source: `${file}:configurer`,
      file,
    });
  }

  return rules;
}

function normalizeControllerPattern(pattern: string): string {
  return pattern.trim();
}

/**
 * Merge auto-discovered rules with manual config entries.
 * Manual rules override auto on the same normalized `controllerPattern`.
 */
export function mergePathRules(
  auto: ResolvedJavaPathRules,
  manual: ControllerPathPrefixConfig[]
): ResolvedJavaPathRules {
  const byPattern = new Map<string, ControllerPathPrefixRule>();

  for (const rule of auto.controllerPrefixes) {
    byPattern.set(normalizeControllerPattern(rule.controllerPattern), rule);
  }

  for (const entry of manual) {
    const key = normalizeControllerPattern(entry.controllerPattern);
    const existing = byPattern.get(key);
    byPattern.set(key, {
      prefix: entry.prefix,
      controllerPattern: key,
      source: entry.source ?? "manual",
      overrides: existing?.source ?? null,
    });
  }

  const hasManual = manual.length > 0;
  const hasAuto = auto.controllerPrefixes.length > 0;
  let confidence = auto.confidence;

  if (hasManual && !hasAuto) {
    confidence = "medium";
  } else if (hasManual && hasAuto) {
    confidence = auto.confidence === "high" ? "high" : "medium";
  }

  const sources = [...auto.sources];
  if (hasManual) sources.push("manual");

  return {
    contextPath: auto.contextPath,
    controllerPrefixes: [...byPattern.values()],
    confidence,
    sources,
  };
}

/**
 * Auto-discover path rules from project source (WebMvcRegistrations chain,
 * WebProperties direct, yml, etc.) across one or more source roots.
 */
export async function discoverAutoPathRules(
  roots: string[]
): Promise<ResolvedJavaPathRules> {
  const projectRoot = roots[0] ?? ".";
  let sources: string[] = [];
  let controllerPrefixes: ControllerPathPrefixRule[] = [];
  let confidence: ResolvedJavaPathRules["confidence"] = "low";

  const javaFiles = await globJavaFiles(roots);

  // Detector A: WebMvcRegistrations → WebProperties chain (or inline prefixes)
  const registrationFiles: string[] = [];
  for (const file of javaFiles) {
    const content = await fs.readFile(file, "utf-8");
    if (WEB_MVC_REGISTRATIONS_RE.test(content)) {
      registrationFiles.push(file);
    }
  }

  for (const file of registrationFiles) {
    const content = await fs.readFile(file, "utf-8");
    sources.push(file);

    const propsClassName = findReferencedPropertiesClass(content);
    if (propsClassName) {
      const propsFile = await findJavaFileByClassName(roots, propsClassName);
      if (propsFile) {
        const propsContent = await fs.readFile(propsFile, "utf-8");
        const cpMatch = propsContent.match(CONFIG_PROPERTIES_RE);
        const configPrefix = cpMatch?.[1];

        let rules = rulesFromPropertiesJava(propsContent, propsClassName, propsFile);
        if (configPrefix) {
          const ymlFlat = await loadYamlConfigKeys(projectRoot, configPrefix);
          rules = applyYmlOverridesToRules(rules, ymlFlat, configPrefix);
        }

        if (rules.length > 0) {
          controllerPrefixes = mergeRulesByPattern(controllerPrefixes, rules);
          confidence = "high";
        }
      }
    }

    if (controllerPrefixes.length === 0) {
      const inline = rulesFromInlineWebMvc(content, file);
      if (inline.length > 0) {
        controllerPrefixes = mergeRulesByPattern(controllerPrefixes, inline);
        confidence = "medium";
      }
    }
  }

  // Detector B: @ConfigurationProperties + new Api(...) without WebMvcRegistrations chain
  for (const file of javaFiles) {
    const content = await fs.readFile(file, "utf-8");
    const result = await applyDetectorB(
      file,
      content,
      projectRoot,
      controllerPrefixes,
      sources,
      confidence
    );
    controllerPrefixes = result.controllerPrefixes;
    sources = result.sources;
    confidence = result.confidence;
  }

  // Detector C: WebMvcConfigurer with addPathPrefix / pathPrefixes / configurePathMatch
  for (const file of javaFiles) {
    const content = await fs.readFile(file, "utf-8");
    const result = applyDetectorC(
      file,
      content,
      controllerPrefixes,
      sources,
      confidence
    );
    controllerPrefixes = result.controllerPrefixes;
    sources = result.sources;
    confidence = result.confidence;
  }

  // Detector D: AutoConfiguration.imports / spring.factories → config class → B/C
  const moduleDirs = await findMavenModuleDirs(roots);
  const processedFqcn = new Set<string>();

  for (const moduleDir of moduleDirs) {
    const imports = await readAutoConfigurationImports(moduleDir);
    const factories = await readSpringFactoriesAutoConfiguration(moduleDir);
    const autoConfigClasses = [...new Set([...imports, ...factories])];

    for (const fqcn of autoConfigClasses) {
      if (processedFqcn.has(fqcn)) continue;
      processedFqcn.add(fqcn);

      const configFile = await findJavaFileByFqcn(roots, fqcn);
      if (!configFile) continue;

      const configContent = await fs.readFile(configFile, "utf-8");

      const bResult = await applyDetectorB(
        configFile,
        configContent,
        projectRoot,
        controllerPrefixes,
        sources,
        confidence
      );
      controllerPrefixes = bResult.controllerPrefixes;
      sources = bResult.sources;
      confidence = bResult.confidence;

      const cResult = applyDetectorC(
        configFile,
        configContent,
        controllerPrefixes,
        sources,
        confidence
      );
      controllerPrefixes = cResult.controllerPrefixes;
      sources = cResult.sources;
      confidence = cResult.confidence;

      const propsClassName = findReferencedPropertiesClass(configContent);
      if (propsClassName) {
        const propsFile = await findJavaFileByClassName(roots, propsClassName);
        if (propsFile) {
          const propsContent = await fs.readFile(propsFile, "utf-8");
          const propsResult = await applyDetectorB(
            propsFile,
            propsContent,
            projectRoot,
            controllerPrefixes,
            sources,
            confidence
          );
          controllerPrefixes = propsResult.controllerPrefixes;
          sources = propsResult.sources;
          confidence = propsResult.confidence;
        }
      }
    }
  }

  // Detector E: yml-only supplement (*.web.*.prefix + *.controller without Java Api defaults)
  const ymlFlats = await loadYamlApplicationFiles(projectRoot);
  const eResult = applyDetectorE(
    ymlFlats,
    controllerPrefixes,
    sources,
    confidence
  );
  controllerPrefixes = eResult.controllerPrefixes;
  sources = eResult.sources;
  confidence = eResult.confidence;

  const contextPath = await resolveContextPath(projectRoot);
  if (contextPath) sources.push(`context-path:${contextPath}`);

  return {
    contextPath,
    controllerPrefixes,
    confidence,
    sources,
  };
}

/**
 * Discover and merge auto + manual path rules for controller URL prefixes.
 */
export async function resolveJavaPathRules(
  projectRoot: string,
  config?: ArchConfig
): Promise<ResolvedJavaPathRules> {
  const roots = [
    projectRoot,
    ...(config?.java?.extraSourceRoots?.map((r) => path.resolve(projectRoot, r)) ??
      []),
  ];
  const auto = await discoverAutoPathRules(roots);
  const manual = config?.java?.controllerPathPrefixes ?? [];
  return mergePathRules(auto, manual);
}

export function extractJavaPackage(content: string): string | undefined {
  const m = content.match(/^\s*package\s+([\w.]+)\s*;/m);
  return m?.[1];
}
