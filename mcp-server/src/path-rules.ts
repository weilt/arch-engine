import fs from "node:fs/promises";
import path from "node:path";
import {
  loadOrInitConfig,
  readLastScan,
  updateJavaPathRules,
  type UpdateJavaPathRulesInput,
  type UpdateJavaPathRulesResult,
} from "@apt/arch-engine";

type ControllerPathPrefixConfig = {
  prefix: string;
  controllerPattern: string;
  source?: string;
  note?: string;
};

type PathRulesSnapshot = {
  resolvedAt: string;
  contextPath: string;
  confidence: "high" | "medium" | "low";
  rules: {
    prefix: string;
    controllerPattern: string;
    source: string;
    overrides?: string | null;
    file?: string;
  }[];
  sources: string[];
  warnings: string[];
};

const PATH_RULES_FILE = ".ai/arch/path-rules.json";

export type UpdateJavaPathRulesToolInput = {
  rules: { prefix: string; controllerPattern: string; note?: string }[];
  mode?: "merge" | "replace-manual";
  reindex?: boolean;
  extraSourceRoots?: string[];
};

export type QueryPathRulesResult = {
  pathRulesFile: string;
  snapshot: PathRulesSnapshot | null;
  java: {
    controllerPathPrefixes?: ControllerPathPrefixConfig[];
    extraSourceRoots?: string[];
  };
  pathRulesHash?: string;
};

export async function handleUpdateJavaPathRules(
  projectRoot: string,
  input: UpdateJavaPathRulesToolInput
): Promise<UpdateJavaPathRulesResult> {
  return updateJavaPathRules(projectRoot, input as UpdateJavaPathRulesInput);
}

export async function handleQueryPathRules(
  projectRoot: string
): Promise<QueryPathRulesResult> {
  const snapshotPath = path.join(projectRoot, PATH_RULES_FILE);

  let snapshot: PathRulesSnapshot | null = null;
  try {
    const raw = await fs.readFile(snapshotPath, "utf-8");
    snapshot = JSON.parse(raw) as PathRulesSnapshot;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
  }

  const { config } = await loadOrInitConfig(projectRoot);
  const javaConfig = config.java;
  const java: QueryPathRulesResult["java"] = {};
  if (javaConfig?.controllerPathPrefixes?.length) {
    java.controllerPathPrefixes = javaConfig.controllerPathPrefixes;
  }
  if (javaConfig?.extraSourceRoots?.length) {
    java.extraSourceRoots = javaConfig.extraSourceRoots;
  }

  const lastScan = await readLastScan(projectRoot);

  return {
    pathRulesFile: PATH_RULES_FILE,
    snapshot,
    java,
    ...(lastScan?.pathRulesHash !== undefined
      ? { pathRulesHash: lastScan.pathRulesHash }
      : {}),
  };
}
