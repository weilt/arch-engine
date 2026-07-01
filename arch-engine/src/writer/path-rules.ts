import fs from "node:fs/promises";
import path from "node:path";
import type { ControllerPathPrefixRule, ResolvedJavaPathRules } from "../scanners/java-path-rules.js";
import type { PathRulesSnapshot, PathRulesSnapshotRule } from "../types.js";
import { getArchDir } from "../paths.js";

function toSnapshotRule(
  projectRoot: string,
  rule: ControllerPathPrefixRule
): PathRulesSnapshotRule {
  let source = rule.source;
  let file = rule.file;

  const fileSourceMatch = source.match(/^(.+\.java)\s+(.+)$/);
  if (fileSourceMatch) {
    file = path.relative(projectRoot, fileSourceMatch[1]!).replace(/\\/g, "/");
    source = fileSourceMatch[2]!;
  }

  return {
    prefix: rule.prefix,
    controllerPattern: rule.controllerPattern,
    source,
    overrides: rule.overrides ?? null,
    ...(file ? { file } : {}),
  };
}

/** Write resolved path rules to `.ai/arch/path-rules.json`. */
export async function writePathRulesSnapshot(
  projectRoot: string,
  resolved: ResolvedJavaPathRules
): Promise<void> {
  const archDir = getArchDir(projectRoot);
  await fs.mkdir(archDir, { recursive: true });

  const snapshot: PathRulesSnapshot = {
    resolvedAt: new Date().toISOString(),
    contextPath: resolved.contextPath,
    confidence: resolved.confidence,
    rules: resolved.controllerPrefixes.map((rule) => toSnapshotRule(projectRoot, rule)),
    sources: resolved.sources,
    warnings: [],
  };

  const outPath = path.join(archDir, "path-rules.json");
  await fs.writeFile(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
}
