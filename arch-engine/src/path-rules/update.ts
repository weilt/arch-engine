import fs from "node:fs/promises";
import path from "node:path";
import { loadOrInitConfig } from "../config.js";
import { getArchConfigPath } from "../paths.js";
import { runReindexApis, type ReindexApisReport } from "../reindex/apis.js";
import { findMavenModules, scanJavaSources } from "../scanners/java.js";
import { resolveJavaPathRules } from "../scanners/java-path-rules.js";
import { mergeDocumentModel } from "../scanners/merge.js";
import { scanOpenApiGlobs } from "../scanners/openapi.js";
import type {
  ApiEndpoint,
  ArchConfig,
  ControllerPathPrefixConfig,
} from "../types.js";

export interface UpdateJavaPathRulesInput {
  rules: { prefix: string; controllerPattern: string; note?: string }[];
  mode?: "merge" | "replace-manual";
  reindex?: boolean;
  extraSourceRoots?: string[];
}

export interface UpdateJavaPathRulesSamplePath {
  before: string;
  after: string;
}

export interface UpdateJavaPathRulesReindexResult {
  apis: number;
  modulesUpdated: string[];
  samplePaths?: UpdateJavaPathRulesSamplePath[];
}

export interface UpdateJavaPathRulesResult {
  ok: true;
  pathRulesFile: string;
  rulesApplied: number;
  reindex?: UpdateJavaPathRulesReindexResult;
}

export interface UpdateJavaPathRulesDeps {
  runReindexApisFn?: (
    projectRoot: string
  ) => Promise<ReindexApisReport>;
  scanApisFn?: (
    projectRoot: string,
    config: ArchConfig
  ) => Promise<ApiEndpoint[]>;
}

const PATH_RULES_FILE = ".ai/arch/path-rules.json";

function validateRules(
  rules: UpdateJavaPathRulesInput["rules"]
): void {
  for (const rule of rules) {
    if (!rule.prefix.startsWith("/")) {
      throw new Error(
        `java.controllerPathPrefixes[].prefix must start with "/" (got: ${rule.prefix})`
      );
    }
    if (!rule.controllerPattern.trim()) {
      throw new Error("java.controllerPathPrefixes[].controllerPattern is required");
    }
  }
}

function toManualRules(
  rules: UpdateJavaPathRulesInput["rules"]
): ControllerPathPrefixConfig[] {
  return rules.map((rule) => ({
    prefix: rule.prefix,
    controllerPattern: rule.controllerPattern,
    source: "manual",
    ...(rule.note !== undefined ? { note: rule.note } : {}),
  }));
}

function mergeManualRules(
  existing: ControllerPathPrefixConfig[] | undefined,
  incoming: ControllerPathPrefixConfig[]
): ControllerPathPrefixConfig[] {
  const byPattern = new Map<string, ControllerPathPrefixConfig>();
  for (const rule of existing ?? []) {
    byPattern.set(rule.controllerPattern, rule);
  }
  for (const rule of incoming) {
    byPattern.set(rule.controllerPattern, rule);
  }
  return [...byPattern.values()];
}

async function readRawConfig(projectRoot: string): Promise<Record<string, unknown>> {
  const configPath = getArchConfigPath(projectRoot);
  const raw = await fs.readFile(configPath, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function atomicWriteConfig(
  projectRoot: string,
  config: Record<string, unknown>
): Promise<void> {
  const configPath = getArchConfigPath(projectRoot);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const tmp = configPath + ".tmp";
  await fs.writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  await fs.rename(tmp, configPath);
}

function applyRulesToConfig(
  rawConfig: Record<string, unknown>,
  input: UpdateJavaPathRulesInput
): ControllerPathPrefixConfig[] {
  const java =
    rawConfig.java && typeof rawConfig.java === "object" && !Array.isArray(rawConfig.java)
      ? { ...(rawConfig.java as Record<string, unknown>) }
      : {};

  const manualRules = toManualRules(input.rules);
  const mode = input.mode ?? "merge";

  const nextPrefixes =
    mode === "replace-manual"
      ? manualRules
      : mergeManualRules(
          (java.controllerPathPrefixes as ControllerPathPrefixConfig[] | undefined) ??
            [],
          manualRules
        );

  java.controllerPathPrefixes = nextPrefixes;

  if (input.extraSourceRoots !== undefined) {
    java.extraSourceRoots = input.extraSourceRoots;
  }

  rawConfig.java = java;
  return nextPrefixes;
}

async function defaultScanApis(
  projectRoot: string,
  config: ArchConfig
): Promise<ApiEndpoint[]> {
  if (!config.scanners.java) {
    const openApis = await scanOpenApiGlobs(projectRoot, config.apiSpecGlobs);
    return mergeDocumentModel([], openApis, [], [], []).apis;
  }

  const javaPathRules = await resolveJavaPathRules(projectRoot, config);
  const modules = await findMavenModules(projectRoot);
  const { apis, rpcs } = await scanJavaSources(
    projectRoot,
    modules,
    javaPathRules,
    config
  );
  const openApis = await scanOpenApiGlobs(projectRoot, config.apiSpecGlobs);
  return mergeDocumentModel(apis, openApis, rpcs, modules, []).apis;
}

function formatApiPath(api: ApiEndpoint): string {
  return `${api.method} ${api.path}`;
}

function collectSamplePathDiffs(
  before: ApiEndpoint[],
  after: ApiEndpoint[]
): UpdateJavaPathRulesSamplePath[] {
  const samples: UpdateJavaPathRulesSamplePath[] = [];

  for (const b of before) {
    const match = after.find(
      (a) =>
        a.method === b.method &&
        a.path !== b.path &&
        (a.path.endsWith(b.path) || a.path === `${b.path}`)
    );
    if (!match) continue;
    samples.push({
      before: formatApiPath(b),
      after: formatApiPath(match),
    });
    if (samples.length >= 5) break;
  }

  return samples;
}

function collectModulesWithPathChanges(
  before: ApiEndpoint[],
  after: ApiEndpoint[]
): string[] {
  const changed = new Set<string>();
  for (const b of before) {
    const match = after.find(
      (a) => a.method === b.method && a.path !== b.path && a.path.endsWith(b.path)
    );
    if (match) changed.add(match.moduleSlug);
  }
  if (changed.size > 0) return [...changed];
  return [...new Set(after.map((a) => a.moduleSlug))];
}

export async function updateJavaPathRules(
  projectRoot: string,
  input: UpdateJavaPathRulesInput,
  deps: UpdateJavaPathRulesDeps = {}
): Promise<UpdateJavaPathRulesResult> {
  validateRules(input.rules);

  const { config: loadedConfig, created } = await loadOrInitConfig(projectRoot);
  if (created) {
    throw new Error(
      "arch.config.json was just created; configure the project before updating path rules"
    );
  }

  const shouldReindex = input.reindex !== false;
  const scanApis = deps.scanApisFn ?? defaultScanApis;
  let beforeApis: ApiEndpoint[] | undefined;

  if (shouldReindex) {
    beforeApis = await scanApis(projectRoot, loadedConfig);
  }

  const rawConfig = await readRawConfig(projectRoot);
  const appliedRules = applyRulesToConfig(rawConfig, input);
  await atomicWriteConfig(projectRoot, rawConfig);

  const result: UpdateJavaPathRulesResult = {
    ok: true,
    pathRulesFile: PATH_RULES_FILE,
    rulesApplied: appliedRules.length,
  };

  if (!shouldReindex) {
    return result;
  }

  const runReindex = deps.runReindexApisFn ?? runReindexApis;
  const reindexReport = await runReindex(projectRoot);

  const { config: updatedConfig } = await loadOrInitConfig(projectRoot);
  const afterApis = await scanApis(projectRoot, updatedConfig);

  const samplePaths =
    beforeApis && beforeApis.length > 0
      ? collectSamplePathDiffs(beforeApis, afterApis)
      : undefined;

  const modulesUpdated = beforeApis
    ? collectModulesWithPathChanges(beforeApis, afterApis)
    : [...new Set(afterApis.map((a) => a.moduleSlug))];

  result.reindex = {
    apis: reindexReport.apiCount,
    modulesUpdated,
    ...(samplePaths && samplePaths.length > 0 ? { samplePaths } : {}),
  };

  return result;
}
