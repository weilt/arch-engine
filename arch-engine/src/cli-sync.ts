#!/usr/bin/env node
import path from "node:path";
import { getArchConfigPath } from "./paths.js";
import { runSyncChanges } from "./sync/run.js";
import fs from "node:fs/promises";

function printHelp(): void {
  console.log(`Usage: sync-changes [projectRoot] [options]

Options:
  --dry-run          Audit only; do not refresh or remove
  --since <anchor>   Git anchor (default: last-scan)
  --paths <a,b,c>    Comma-separated relative source paths
  -h, --help         Show this help
`);
}

function parseArgs(argv: string[]): {
  projectRoot: string;
  dryRun: boolean;
  since?: string;
  paths?: string[];
} {
  const args = [...argv];
  let dryRun = false;
  let since: string | undefined;
  let paths: string[] | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--since") {
      since = args[++i];
      continue;
    }
    if (a === "--paths") {
      const raw = args[++i] ?? "";
      paths = raw.split(",").map((p) => p.trim()).filter(Boolean);
      continue;
    }
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
    if (!a.startsWith("-")) {
      positional.push(a);
    }
  }

  const projectRoot = positional[0] ? path.resolve(positional[0]) : process.cwd();
  return { projectRoot, dryRun, since, paths };
}

async function main(): Promise<void> {
  const { projectRoot, dryRun, since, paths } = parseArgs(process.argv.slice(2));

  try {
    await fs.access(getArchConfigPath(projectRoot));
  } catch {
    console.error("❌ arch.config.json not found. Run start-init first.");
    process.exit(2);
  }

  const report = await runSyncChanges(projectRoot, { dryRun, since, paths });

  const summary = {
    mode: report.audit.anchor.mode,
    anchor: report.audit.anchor.commit,
    modified: report.audit.modified.length,
    unregistered: report.audit.unregistered.length,
    new: report.audit.new.length,
    deleted: report.audit.deleted.length,
    refreshed: report.refreshed.length,
    removed: report.removed.length,
    errors: report.errors.length,
    dryRun,
  };

  console.log(JSON.stringify({ summary, report }, null, 2));

  if (report.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
