#!/usr/bin/env node
// apt-status CLI: thin wrapper over handleQueryProjectStatus.
//   --json -> machine-readable ProjectStatus (hooks / autonomous loop)
//   (none) -> human-readable block for /current-status
// ASCII markers only (no emoji / no non-ASCII) to keep output portable across
// shells and logs.
import { handleQueryProjectStatus } from "./status/aggregate.js";
import { getProjectRoot } from "./paths.js";
import type { ProjectStatus } from "./status/types.js";
import { pathToFileURL } from "node:url";

const OK = "[ok]";
const INFO = "[i]";
const BLOCK = "[!]";

export async function runCliStatus(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const status: ProjectStatus = await handleQueryProjectStatus(getProjectRoot());

  if (json) {
    process.stdout.write(JSON.stringify(status, null, 2) + "\n");
    return 0;
  }

  const lines: string[] = [];
  lines.push("=== APT Project Status ===");
  lines.push(`${INFO} phase    : ${status.phase}`);
  lines.push(`${INFO} loopDone : ${status.loopDone ? "true" : "false"}`);
  lines.push(`${INFO} next     : ${status.nextAction}`);
  if (status.goal) lines.push(`${INFO} goal     : ${status.goal}`);
  if (status.activeSpec) lines.push(`${INFO} spec     : ${status.activeSpec}`);
  if (status.activePlan) lines.push(`${INFO} plan     : ${status.activePlan}`);
  if (status.tasks && status.tasks.total > 0) {
    const blockedSuffix =
      status.tasks.blocked > 0 ? ` (${status.tasks.blocked} blocked)` : "";
    lines.push(
      `${INFO} tasks    : ${status.tasks.done}/${status.tasks.total} done${blockedSuffix}`
    );
  }
  if (status.lastVerify) {
    lines.push(`${INFO} verify   : ${status.lastVerify.result}`);
  }
  if (status.blockers.length > 0) {
    lines.push(`${BLOCK} blockers :`);
    for (const blocker of status.blockers) lines.push(`   - ${blocker}`);
  }
  lines.push(`${OK} ${status.summary}`);
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

async function main(): Promise<void> {
  try {
    const code = await runCliStatus(process.argv.slice(2));
    process.exit(code);
  } catch (err) {
    process.stderr.write(
      `apt-status failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }
}

// Only auto-run when executed directly (node dist/cli-status.js), not when
// imported (e.g. by tests). Keeps the bin entrypoint working while leaving
// runCliStatus unit-testable.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
