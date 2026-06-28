/**
 * Cursor "stop" hook example for the APT autonomous loop.
 *
 * EXAMPLE / REFERENCE ONLY.
 * - This file is NOT compiled, type-checked, or shipped as part of the APT
 *   MCP server. It lives under templates/ and is meant to be copied into a
 *   real Cursor extension and adapted.
 * - The Cursor hook API surface is NOT pinned in this repo. The event name,
 *   handler signature, and the "followup message" payload shape below are
 *   representative placeholders. Replace them with whatever your Cursor
 *   version actually exposes before use.
 *
 * Purpose (spec 3.4 and 11; templates/_apt-goal-loop.md):
 * When the agent finishes a turn, read `apt-status --json`. If the APT loop
 * is not yet done and not blocked, inject `/apt-goal --continue` as a followup
 * so the loop resumes on its own. If the loop is done, or a human must
 * resolve a blocker first, do nothing and let the turn end.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

// Minimal subset of the ProjectStatus object emitted by `apt-status --json`.
// See mcp-server/src/status/types.ts for the authoritative, full shape.
interface AptProjectStatus {
  phase: string; // e.g. "implementing" | "verifying" | "done" | "blocked" | ...
  loopDone: boolean;
  nextAction: string; // e.g. "implement_plan" | "verify" | "none" | ...
  blockers?: string[];
  summary?: string;
}

// The followup message Cursor should send back into the agent conversation.
// Replace this shape with the real Cursor "followup" / "prompt" payload.
interface CursorFollowup {
  prompt: string;
}

const RESUME_PROMPT = "/apt-goal --continue";

/**
 * Pure decision function (unit-testable). Given an APT status, return the
 * followup prompt to inject, or null to stay quiet.
 *  - loopDone === true   -> loop complete, nothing to do.
 *  - phase === "blocked" -> a human must resolve a blocker; never auto-resume.
 *  - otherwise           -> loop still in progress; ask the agent to continue.
 */
export function decideFollowup(status: AptProjectStatus): string | null {
  if (status.loopDone === true) return null;
  if (status.phase === "blocked") return null;
  return RESUME_PROMPT;
}

/**
 * Run `apt-status --json` via child_process and decide whether to resume.
 * Returns the followup prompt, or null. Never throws (logs to stderr instead)
 * so a status read failure can never break the editor.
 */
export async function runStatusAndDecide(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("apt-status", ["--json"], {
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const status = JSON.parse(stdout) as AptProjectStatus;
    return decideFollowup(status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[apt-stop-hook] apt-status failed: ${msg}\n`);
    return null;
  }
}

/**
 * Representative Cursor "stop" hook entrypoint. Cursor calls this when the
 * agent finishes a turn. Returning a non-null object injects it as a followup;
 * returning null ends the turn.
 *
 * NOTE: the real signature, event payload, and followup shape depend on the
 * Cursor version. Wire `event` and the return type to your actual API.
 */
export async function onStop(event: unknown): Promise<CursorFollowup | null> {
  void event; // ignored in this minimal example
  const prompt = await runStatusAndDecide();
  return prompt === null ? null : { prompt };
}

/**
 * Thin local entrypoint for manual sanity checks
 * (e.g. `npx ts-node templates/hooks/cursor-stop-apt.example.ts`).
 */
async function main(): Promise<void> {
  const prompt = await runStatusAndDecide();
  process.stdout.write(
    prompt === null ? "(no followup; loop done or blocked)\n" : `${prompt}\n`
  );
}

// Run main() only when executed directly, not when imported by a hook runtime.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
