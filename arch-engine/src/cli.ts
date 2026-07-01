#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { archLog, setArchLogVerbose } from "./log.js";
import { runStartInit } from "./pipeline.js";
import { getArchIndexPath } from "./paths.js";
import { runReindexApis } from "./reindex/apis.js";

export interface CliOptions {
  projectRoot: string;
  full: boolean;
  reindexApis: boolean;
  verbose: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const reindexApis = argv.includes("--reindex-apis");
  const full = argv.includes("--full") && !reindexApis;
  const positional = argv.filter((a) => !a.startsWith("-"));
  const projectRoot = positional[0] ? path.resolve(positional[0]) : process.cwd();
  return { projectRoot, full, reindexApis, verbose };
}

async function archIndexExists(projectRoot: string): Promise<boolean> {
  try {
    await fs.access(getArchIndexPath(projectRoot));
    return true;
  } catch {
    return false;
  }
}

export async function runCli(options: CliOptions): Promise<number> {
  const { projectRoot, full, reindexApis } = options;

  if (reindexApis) {
    if (process.argv.includes("--full")) {
      archLog.warn("--reindex-apis takes precedence over --full");
    }

    if (!(await archIndexExists(projectRoot))) {
      console.error(
        "arch-index.json not found — run start-init first to create the architecture index"
      );
      return 2;
    }

    const report = await runReindexApis(projectRoot);
    console.log(
      `✅ reindex-apis complete: ${report.apiCount} APIs, ${report.modulesUpdated} modules updated`
    );
    return 0;
  }

  const report = await runStartInit(projectRoot, {}, { full });

  if (report.status === "config-created") {
    console.log(
      "✅ Created arch.config.json — add apiKey in arch.config.json or arch.secrets.json (or set OPENAI_API_KEY), then re-run start-init"
    );
    return 0;
  }

  console.log(
    `✅ start-init complete: ${report.apiCount} APIs, ${report.moduleCount} modules, ${report.chunkCount} chunks`
  );
  return 0;
}

function isEmbeddingError(message: string): boolean {
  return (
    message.includes("Missing API key") ||
    message.includes("Missing env") ||
    message.includes("Embedding failed") ||
    message.includes("Semantic split failed")
  );
}

function isConfigError(message: string): boolean {
  return message.includes("JSON") || message.includes("config");
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.verbose) {
    setArchLogVerbose(true);
  }
  process.exit(await runCli(options));
}

// Only auto-run when executed directly (node dist/cli.js), not when
// imported (e.g. by tests).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    if (err instanceof Error && err.cause) {
      console.error("Cause:", err.cause);
    }
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }

    if (isEmbeddingError(message)) {
      process.exit(1);
    }
    if (isConfigError(message)) {
      process.exit(2);
    }
    process.exit(1);
  });
}
