// Status aggregate: recomputes phase / loopDone / nextAction from `.apt/*`
// state files + arch audit + progress.md. Spec source of truth:
//   phase      -> spec section 4.2 (8-state decision tree)
//   loopDone   -> spec section 5  (six hard conditions, AND)
//   nextAction -> spec section 3.3 (single-action mapping)
// Fault-tolerant by design: missing input files never throw (spec section 9),
// except db.json / last-scan absence, which mandate phase=blocked.
import fs from "node:fs/promises";
import path from "node:path";
import {
  auditArchChanges,
  MissingLastScanError,
  type AuditArchChangesResult,
} from "@apt/arch-engine";
import { getDbPath } from "../paths.js";
import { classifySpecRisk } from "./risk.js";
import { readLatestVerify } from "./verify-parse.js";
import type {
  ApprovalState,
  LastVerify,
  NextAction,
  Phase,
  ProjectStatus,
  SpecRisk,
  StatusSnapshot,
  TasksSummary,
} from "./types.js";

export interface AggregateOptions {
  // Reserved for deterministic time in callers/tests; the core recompute is
  // time-independent (it only reads on-disk state).
  now?: () => Date;
  // Defaults to the real auditArchChanges. Tests stub it to skip a live scan.
  audit?: () => Promise<AuditArchChangesResult>;
  // Defaults to fs.access on .ai/db.json. Tests stub it.
  dbExists?: () => Promise<boolean>;
}

const SPECS_REL = path.join("docs", "superpowers", "specs");
const PLANS_REL = path.join("docs", "apt", "plans");
const GOAL_REL = path.join(".apt", "goal.md");
const APPROVALS_REL = path.join(".apt", "approvals.json");
const STATUS_REL = path.join(".apt", "status.json");
const PROGRESS_REL = path.join(".apt", "orchestration", "progress.md");

// Loose shape of an approvals.json entry; extra fields are tolerated.
type ApprovalEntry = { spec?: string; approval?: unknown } & Record<
  string,
  unknown
>;

// ---------------------------------------------------------------------------
// Fault-tolerant readers
// ---------------------------------------------------------------------------

async function readText(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

// goal.md -> first non-empty, non-heading, non-comment line (truncated).
function extractGoal(text: string | undefined): string | undefined {
  if (!text) return undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("<!--")) continue;
    return line.length > 120 ? `${line.slice(0, 117)}...` : line;
  }
  return undefined;
}

// Minimal YAML frontmatter parser (only `key: value` scalars are needed for
// the risk gate). Returns undefined when no leading `---` block is present.
function parseFrontmatter(
  text: string
): Record<string, unknown> | undefined {
  if (!text.startsWith("---")) return undefined;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return undefined;
  const fm: Record<string, unknown> = {};
  for (const raw of text.slice(3, end).split(/\r?\n/)) {
    const match = raw.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    fm[match[1]] =
      value === "true" ? true : value === "false" ? false : value;
  }
  return fm;
}

// Most recently modified `*-design.md` spec (relative posix path + full text).
async function findActiveSpec(
  projectRoot: string
): Promise<{ rel: string; text: string } | undefined> {
  const dir = path.join(projectRoot, SPECS_REL);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return undefined;
  }
  let best: { name: string; mtime: number } | undefined;
  for (const name of names) {
    if (!name.endsWith("-design.md")) continue;
    try {
      const st = await fs.stat(path.join(dir, name));
      if (!best || st.mtimeMs > best.mtime) best = { name, mtime: st.mtimeMs };
    } catch {
      // skip unreadable entries
    }
  }
  if (!best) return undefined;
  const text = (await readText(path.join(dir, best.name))) ?? "";
  const rel = path.join(SPECS_REL, best.name).replace(/\\/g, "/");
  return { rel, text };
}

// Most recently modified `*-plan.md` (relative posix path) or undefined.
async function findActivePlan(
  projectRoot: string
): Promise<string | undefined> {
  const dir = path.join(projectRoot, PLANS_REL);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return undefined;
  }
  let best: { name: string; mtime: number } | undefined;
  for (const name of names) {
    if (!name.endsWith("-plan.md")) continue;
    try {
      const st = await fs.stat(path.join(dir, name));
      if (!best || st.mtimeMs > best.mtime) best = { name, mtime: st.mtimeMs };
    } catch {
      // skip unreadable entries
    }
  }
  if (!best) return undefined;
  return path.join(PLANS_REL, best.name).replace(/\\/g, "/");
}

async function readApprovals(projectRoot: string): Promise<ApprovalEntry[]> {
  const text = await readText(path.join(projectRoot, APPROVALS_REL));
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as ApprovalEntry[]) : [];
  } catch {
    return [];
  }
}

function normalizeApproval(value: unknown): ApprovalState | undefined {
  if (
    value === "pending" ||
    value === "approved" ||
    value === "auto_approved"
  ) {
    return value;
  }
  return undefined;
}

// progress.md -> tasks ledger. Checkbox task list only:
//   `- [x]` done, `- [ ]` pending, `- [!|~|?]` blocked.
// No recognized task lines + non-empty body -> blocker (format drift). Missing
// or empty file -> {0,0,0} with no blocker.
const TASK_LINE_RE = /^\s*[-*+]\s*\[([ xX!~?])\]\s+\S/;

function parseProgress(text: string): {
  tasks: TasksSummary;
  blocker?: string;
} {
  let total = 0;
  let done = 0;
  let blocked = 0;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(TASK_LINE_RE);
    if (!match) continue;
    total++;
    const mark = match[1];
    if (mark === "x" || mark === "X") done++;
    else if (mark === "!" || mark === "~" || mark === "?") blocked++;
  }
  if (total > 0) {
    return { tasks: { total, done, blocked } };
  }
  if (text.trim().length === 0) {
    return { tasks: { total: 0, done: 0, blocked: 0 } };
  }
  return {
    tasks: { total: 0, done: 0, blocked: 0 },
    blocker:
      "progress.md present but no task lines recognized; ledger format may have drifted",
  };
}

function auditCategoriesEmpty(audit: AuditArchChangesResult | null): boolean {
  if (!audit) return false;
  return (
    audit.new.length === 0 &&
    audit.modified.length === 0 &&
    audit.deleted.length === 0 &&
    audit.unregistered.length === 0
  );
}

function defaultDbExists(projectRoot: string): () => Promise<boolean> {
  return async () => {
    try {
      await fs.access(getDbPath(projectRoot));
      return true;
    } catch {
      return false;
    }
  };
}

function defaultAudit(
  projectRoot: string
): () => Promise<AuditArchChangesResult> {
  return () => auditArchChanges(projectRoot);
}

// ---------------------------------------------------------------------------
// Phase / loopDone / nextAction decision logic (spec 4.2 / 5 / 3.3)
// ---------------------------------------------------------------------------

// loopDone (spec 5): AND of all six conditions. verify PASS already implies
// the audit is clean (spec 5.4), but we still AND-in the explicit four-bucket
// emptiness check the spec mandates as a double-check.
function computeLoopDone(args: {
  goal?: string;
  activePlan?: string;
  tasks?: TasksSummary;
  lastVerify: LastVerify;
  auditEmpty: boolean;
  hasApprovalBlocker: boolean;
  hasDesignBlocker: boolean;
}): boolean {
  const {
    goal,
    activePlan,
    tasks,
    lastVerify,
    auditEmpty,
    hasApprovalBlocker,
    hasDesignBlocker,
  } = args;
  return (
    Boolean(goal) &&
    Boolean(activePlan) &&
    !!tasks &&
    tasks.total > 0 &&
    tasks.done === tasks.total &&
    lastVerify.result === "PASS" &&
    auditEmpty &&
    !hasApprovalBlocker &&
    !hasDesignBlocker
  );
}

// Single nextAction for the computed phase. Precedence (one action only):
//   blocked > done > spec_pending_approval >
//   verifying(FAIL->finish_feature, else verify) >
//   implementing > planning(plan?implement_plan:plan_from_spec) >
//   brainstorming(spec?plan_from_spec:auto_brainstorm) >
//   idle(goal?auto_brainstorm:none).
// `feature` (the no-spec fallback) is intentionally not chosen here; spec 3.3
// lists it as an alternative but the explicit test contract and the
// /apt-goal primary path route idle+goal to auto_brainstorm.
function computeNextAction(args: {
  phase: Phase;
  goal?: string;
  activeSpec?: string;
  activePlan?: string;
  lastVerify: LastVerify;
}): NextAction {
  const { phase, goal, activeSpec, activePlan, lastVerify } = args;
  switch (phase) {
    case "blocked":
      // spec 9: both agent-init (db.json) and start-init (last-scan) map here.
      return "start_init";
    case "done":
      return "none";
    case "spec_pending_approval":
      return "await_spec_approval";
    case "verifying":
      return lastVerify.result === "FAIL" ? "finish_feature" : "verify";
    case "implementing":
      return "implement_plan";
    case "planning":
      return activePlan ? "implement_plan" : "plan_from_spec";
    case "brainstorming":
      return activeSpec ? "plan_from_spec" : "auto_brainstorm";
    case "idle":
    default:
      return goal ? "auto_brainstorm" : "none";
  }
}

function buildSummary(
  phase: Phase,
  tasks: TasksSummary | undefined,
  lastVerify: LastVerify,
  nextAction: NextAction
): string {
  const tasksPart = tasks ? ` tasks=${tasks.done}/${tasks.total}` : "";
  return `phase=${phase}${tasksPart} verify=${lastVerify.result} next=${nextAction}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function aggregateStatus(
  projectRoot: string,
  opts: AggregateOptions = {}
): Promise<ProjectStatus> {
  const blockers: string[] = [];

  // 1. Read on-disk inputs (all fault-tolerant).
  const goal = extractGoal(await readText(path.join(projectRoot, GOAL_REL)));

  const specInfo = await findActiveSpec(projectRoot);
  const activeSpec = specInfo?.rel;
  const specRisk: SpecRisk | undefined = specInfo
    ? classifySpecRisk({
        text: specInfo.text,
        frontmatter: parseFrontmatter(specInfo.text),
      })
    : undefined;

  const approvals = await readApprovals(projectRoot);
  const specApproval = activeSpec
    ? normalizeApproval(
        approvals.find((entry) => entry?.spec === activeSpec)?.approval
      )
    : undefined;

  const activePlan = await findActivePlan(projectRoot);

  const progressText = await readText(path.join(projectRoot, PROGRESS_REL));
  let tasks: TasksSummary = { total: 0, done: 0, blocked: 0 };
  if (progressText !== undefined) {
    const parsed = parseProgress(progressText);
    tasks = parsed.tasks;
    if (parsed.blocker) blockers.push(parsed.blocker);
  }

  const lastVerify = await readLatestVerify(projectRoot);

  // 2. db presence + arch audit (the only sources that can force `blocked`).
  const dbExists = opts.dbExists ?? defaultDbExists(projectRoot);
  const audit = opts.audit ?? defaultAudit(projectRoot);

  let auditResult: AuditArchChangesResult | null = null;
  let blockedReason: string | null = null;

  if (!(await dbExists())) {
    blockedReason =
      "Missing .ai/db.json: run agent-init to initialize the project.";
  } else {
    try {
      auditResult = await audit();
    } catch (err) {
      if (err instanceof MissingLastScanError) {
        blockedReason =
          "Missing last-scan.json: run start-init to index the architecture.";
      } else {
        // Unexpected audit failure: record but do not force blocked; loopDone
        // stays false because the audit could not be confirmed clean.
        blockers.push(
          `arch audit failed: ${err instanceof Error ? err.message : String(err)}`
        );
        auditResult = null;
      }
    }
  }
  if (blockedReason) blockers.push(blockedReason);

  // 3. loopDone (independent AND of six conditions).
  const hasApprovalBlocker = blockers.some((b) => /approval/i.test(b));
  const hasDesignBlocker = blockers.some((b) => /design/i.test(b));
  const loopDone = computeLoopDone({
    goal,
    activePlan,
    tasks,
    lastVerify,
    auditEmpty: auditCategoriesEmpty(auditResult),
    hasApprovalBlocker,
    hasDesignBlocker,
  });

  // 4. phase (precedence order, spec 4.2). Each branch is mutually exclusive.
  //    Documented defensible choices:
  //    - step "verifying" is extended to "all tasks done AND (verify != PASS OR
  //      audit not empty)" so a stale PASS with pending audit changes still
  //      routes to verifying instead of falling through to idle.
  //    - brainstorming requires an activeSpec; a goal with no spec stays idle
  //      and surfaces nextAction=auto_brainstorm.
  let phase: Phase;
  if (blockedReason) {
    phase = "blocked";
  } else if (!activeSpec && !activePlan && !goal) {
    phase = "idle";
  } else if (
    specRisk === "high" &&
    specApproval !== "approved" &&
    specApproval !== "auto_approved"
  ) {
    phase = "spec_pending_approval";
  } else if (activeSpec && specApproval === undefined) {
    phase = "brainstorming";
  } else if (
    (specApproval === "approved" || specApproval === "auto_approved") &&
    tasks.total === 0
  ) {
    phase = "planning";
  } else if (tasks.total > 0 && tasks.done < tasks.total) {
    phase = "implementing";
  } else if (
    tasks.total > 0 &&
    tasks.done === tasks.total &&
    (lastVerify.result !== "PASS" || !auditCategoriesEmpty(auditResult))
  ) {
    phase = "verifying";
  } else if (loopDone) {
    phase = "done";
  } else {
    phase = "idle";
  }

  const nextAction = computeNextAction({
    phase,
    goal,
    activeSpec,
    activePlan,
    lastVerify,
  });

  return {
    phase,
    loopDone,
    nextAction,
    goal,
    activeSpec,
    activePlan,
    specRisk,
    specApproval,
    tasks,
    lastVerify,
    blockers,
    summary: buildSummary(phase, tasks, lastVerify, nextAction),
  };
}

export async function writeStatusSnapshot(
  projectRoot: string,
  status: ProjectStatus
): Promise<void> {
  const snapshot: StatusSnapshot = {
    phase: status.phase,
    loopDone: status.loopDone,
    nextAction: status.nextAction,
    updatedAt: new Date().toISOString(),
  };
  const file = path.join(projectRoot, STATUS_REL);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(snapshot, null, 2), "utf-8");
}

async function readSnapshot(
  projectRoot: string
): Promise<StatusSnapshot | undefined> {
  const text = await readText(path.join(projectRoot, STATUS_REL));
  if (!text) return undefined;
  try {
    return JSON.parse(text) as StatusSnapshot;
  } catch {
    return undefined;
  }
}

// Thin production wrapper: recompute with the real audit/db defaults and write
// the snapshot back only when the loop-critical fields changed (avoids churn).
// Never throws to the MCP caller.
export async function handleQueryProjectStatus(
  projectRoot: string
): Promise<ProjectStatus> {
  try {
    const status = await aggregateStatus(projectRoot);
    try {
      const prev = await readSnapshot(projectRoot);
      const changed =
        !prev ||
        prev.phase !== status.phase ||
        prev.loopDone !== status.loopDone ||
        prev.nextAction !== status.nextAction;
      if (changed) {
        await writeStatusSnapshot(projectRoot, status);
      }
    } catch {
      // write-back is best-effort; never surface it to the caller
    }
    return status;
  } catch (err) {
    return {
      phase: "blocked",
      loopDone: false,
      nextAction: "start_init",
      blockers: [
        `status aggregation failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
      summary: "phase=blocked verify=none next=start_init",
    };
  }
}
