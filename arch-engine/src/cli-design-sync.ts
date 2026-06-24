#!/usr/bin/env node
import path from "node:path";
import { runDesignSync } from "./design/sync.js";

function printHelp(): void {
  console.log(`Usage: design-sync [projectRoot] [options]

Options:
  --source <path>    Baoyu designs folder (default: designs)
  --dry-run          Report without writing .ai/design/
  --pages-only       Update pages/ and refs/ only
  --incremental      Update only changed source files (falls back to full sync without prior state)
  -h, --help         Show this help
`);
}

function parseArgs(argv: string[]): {
  projectRoot: string;
  source?: string;
  dryRun: boolean;
  pagesOnly: boolean;
  incremental: boolean;
} {
  const args = [...argv];
  let dryRun = false;
  let pagesOnly = false;
  let incremental = false;
  let source: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--pages-only") {
      pagesOnly = true;
      continue;
    }
    if (a === "--incremental") {
      incremental = true;
      continue;
    }
    if (a === "--source") {
      source = args[++i];
      continue;
    }
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
    if (!a.startsWith("-")) positional.push(a);
  }

  const projectRoot = positional[0] ? path.resolve(positional[0]) : process.cwd();
  return { projectRoot, source, dryRun, pagesOnly, incremental };
}

async function main(): Promise<void> {
  const { projectRoot, source, dryRun, pagesOnly, incremental } = parseArgs(process.argv.slice(2));
  const report = await runDesignSync(projectRoot, { source, dryRun, pagesOnly, incremental });
  console.log(JSON.stringify(report, null, 2));
  if (report.warnings.length > 0 && !dryRun) {
    process.exitCode = 0;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
