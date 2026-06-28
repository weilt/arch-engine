import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MissingLastScanError,
  type AuditArchChangesResult,
} from "@apt/arch-engine";
import {
  aggregateStatus,
  handleQueryProjectStatus,
  writeStatusSnapshot,
} from "../../src/status/aggregate.js";

// An arch audit with all four change buckets empty (the "clean" case).
const CLEAN_AUDIT: AuditArchChangesResult = {
  anchor: { commit: "nogit", mode: "fileHashes" },
  new: [],
  modified: [],
  deleted: [],
  unregistered: [],
};

// Stubs that keep tests free of any live arch scan / db access.
const stubs = {
  dbOk: async (): Promise<boolean> => true,
  auditClean: async (): Promise<AuditArchChangesResult> => CLEAN_AUDIT,
};

// Write a sparse fixture project tree under a fresh tmpdir.
async function writeFiles(
  root: string,
  files: Record<string, string>
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
  }
}

const SPEC_NAME = "2026-06-20-demo-design.md";
const SPEC_REL = `docs/superpowers/specs/${SPEC_NAME}`;
const PLAN_REL = "docs/apt/plans/2026-06-20-demo-plan.md";

// A benign (low-risk) spec body with no high-risk keywords.
const LOW_RISK_SPEC = "# Demo Design\n\nA small status display feature.\n";

function approvedSpec(specRel: string, approval: string): string {
  return JSON.stringify([{ spec: specRel, approval }]);
}

describe("aggregateStatus", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "apt-status-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("empty project -> phase idle, nextAction none, loopDone false", async () => {
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: stubs.auditClean,
    });
    expect(status.phase).toBe("idle");
    expect(status.nextAction).toBe("none");
    expect(status.loopDone).toBe(false);
  });

  it("goal set, no spec -> nextAction auto_brainstorm", async () => {
    await writeFiles(root, { ".apt/goal.md": "Ship the demo widget.\n" });
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: stubs.auditClean,
    });
    expect(status.goal).toMatch(/demo widget/);
    expect(status.nextAction).toBe("auto_brainstorm");
  });

  it("approved low-risk spec, no plan -> planning, nextAction plan_from_spec", async () => {
    await writeFiles(root, {
      [SPEC_REL]: LOW_RISK_SPEC,
      ".apt/approvals.json": approvedSpec(SPEC_REL, "approved"),
    });
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: stubs.auditClean,
    });
    expect(status.phase).toBe("planning");
    expect(status.nextAction).toBe("plan_from_spec");
    expect(status.specRisk).toBe("low");
    expect(status.specApproval).toBe("approved");
  });

  it("high-risk pending spec -> spec_pending_approval, await_spec_approval", async () => {
    await writeFiles(root, {
      [SPEC_REL]: "---\nrisk: high\n---\n# Risky\n\nA large redesign.\n",
      ".apt/approvals.json": approvedSpec(SPEC_REL, "pending"),
    });
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: stubs.auditClean,
    });
    expect(status.phase).toBe("spec_pending_approval");
    expect(status.nextAction).toBe("await_spec_approval");
    expect(status.specRisk).toBe("high");
  });

  it("progress has un-DONE task -> implementing, implement_plan, loopDone false", async () => {
    await writeFiles(root, {
      ".apt/goal.md": "Ship demo.\n",
      ".apt/orchestration/progress.md":
        "## Tasks\n\n- [x] scaffold\n- [ ] wire up\n",
    });
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: stubs.auditClean,
    });
    expect(status.phase).toBe("implementing");
    expect(status.nextAction).toBe("implement_plan");
    expect(status.loopDone).toBe(false);
    expect(status.tasks).toEqual({ total: 2, done: 1, blocked: 0 });
  });

  // KEY invariant (spec 1.3 success-criteria-2): all tasks DONE but verify
  // result != PASS -> loopDone is FALSE.
  it("all tasks DONE, verify FAIL -> verifying, loopDone false, finish_feature", async () => {
    await writeFiles(root, {
      ".apt/goal.md": "Ship demo.\n",
      [SPEC_REL]: LOW_RISK_SPEC,
      ".apt/approvals.json": approvedSpec(SPEC_REL, "approved"),
      [PLAN_REL]: "# Demo Plan\n",
      ".apt/orchestration/progress.md": "- [x] a\n- [x] b\n",
      ".apt/verify/latest.md": "# Verify Report\n\n**Overall:** FAIL\n",
    });
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: stubs.auditClean,
    });
    expect(status.phase).toBe("verifying");
    expect(status.loopDone).toBe(false);
    expect(status.nextAction).toBe("finish_feature");
    expect(status.lastVerify?.result).toBe("FAIL");
  });

  it("loopDone true -> phase done, loopDone true, nextAction none", async () => {
    await writeFiles(root, {
      ".apt/goal.md": "Ship demo.\n",
      [SPEC_REL]: LOW_RISK_SPEC,
      ".apt/approvals.json": approvedSpec(SPEC_REL, "approved"),
      [PLAN_REL]: "# Demo Plan\n",
      ".apt/orchestration/progress.md": "- [x] a\n- [x] b\n",
      ".apt/verify/latest.md": "# Verify Report\n\n**Overall:** PASS\n",
    });
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: stubs.auditClean,
    });
    expect(status.phase).toBe("done");
    expect(status.loopDone).toBe(true);
    expect(status.nextAction).toBe("none");
  });

  it("missing .ai/db.json -> blocked, start_init, blocker mentions agent-init", async () => {
    const status = await aggregateStatus(root, {
      dbExists: async () => false,
      audit: stubs.auditClean,
    });
    expect(status.phase).toBe("blocked");
    expect(status.nextAction).toBe("start_init");
    expect(status.blockers.some((b) => b.includes("agent-init"))).toBe(true);
  });

  it("audit throws MissingLastScanError -> blocked, start_init", async () => {
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: async () => {
        throw new MissingLastScanError();
      },
    });
    expect(status.phase).toBe("blocked");
    expect(status.nextAction).toBe("start_init");
    expect(status.blockers.some((b) => b.includes("start-init"))).toBe(true);
  });

  it("missing progress.md -> tasks {0,0,0}, no crash", async () => {
    await writeFiles(root, { ".apt/goal.md": "Ship demo.\n" });
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: stubs.auditClean,
    });
    expect(status.tasks).toEqual({ total: 0, done: 0, blocked: 0 });
  });

  it("unparseable progress.md -> blocker recorded, totals 0, no throw", async () => {
    await writeFiles(root, {
      ".apt/goal.md": "Ship demo.\n",
      ".apt/orchestration/progress.md":
        "this is not a task ledger\n!!!garbage@@@\nno checkboxes here\n",
    });
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: stubs.auditClean,
    });
    expect(status.tasks).toEqual({ total: 0, done: 0, blocked: 0 });
    expect(status.blockers.some((b) => /progress/i.test(b))).toBe(true);
  });

  it("writeStatusSnapshot persists a StatusSnapshot to .apt/status.json", async () => {
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: stubs.auditClean,
    });
    await writeStatusSnapshot(root, status);
    const raw = await fs.readFile(
      path.join(root, ".apt", "status.json"),
      "utf-8"
    );
    const snapshot = JSON.parse(raw);
    expect(snapshot.phase).toBe(status.phase);
    expect(snapshot.loopDone).toBe(status.loopDone);
    expect(snapshot.nextAction).toBe(status.nextAction);
    expect(typeof snapshot.updatedAt).toBe("string");
  });

  it("handleQueryProjectStatus never throws and blocks an uninitialized project", async () => {
    // Real defaults: no .ai/db.json in the tmpdir -> blocked (audit is skipped).
    const status = await handleQueryProjectStatus(root);
    expect(status.phase).toBe("blocked");
    expect(status.nextAction).toBe("start_init");
    // write-back should have persisted the blocked snapshot.
    const exists = await fs
      .access(path.join(root, ".apt", "status.json"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  // Regression guard for the loopDone "NOT spec_pending_approval" fix (spec 5
  // condition 5): even with all tasks DONE + verify PASS + clean audit, a
  // high-risk spec still pending approval must keep loopDone false and route
  // the phase to spec_pending_approval. Before the fix loopDone was true.
  it("high-risk pending spec keeps loopDone false despite all-done + PASS (spec 5 cond 5)", async () => {
    await writeFiles(root, {
      ".apt/goal.md": "Ship demo.\n",
      [SPEC_REL]: "---\nrisk: high\n---\n# Risky\n\nA large redesign.\n",
      ".apt/approvals.json": approvedSpec(SPEC_REL, "pending"),
      [PLAN_REL]: "# Demo Plan\n",
      ".apt/orchestration/progress.md": "- [x] a\n- [x] b\n",
      ".apt/verify/latest.md": "# Verify Report\n\n**Overall:** PASS\n",
    });
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: stubs.auditClean,
    });
    expect(status.phase).toBe("spec_pending_approval");
    expect(status.loopDone).toBe(false);
    expect(status.specRisk).toBe("high");
    expect(status.specApproval).toBe("pending");
  });

  // Pins the documented "verifying" extension (spec 4.2): a stale PASS with a
  // dirty (non-empty) arch audit routes to verifying, not done, so the agent is
  // nudged to re-verify before the loop can terminate.
  it("stale PASS with dirty audit routes to verifying, not done", async () => {
    await writeFiles(root, {
      ".apt/goal.md": "Ship demo.\n",
      [SPEC_REL]: LOW_RISK_SPEC,
      ".apt/approvals.json": approvedSpec(SPEC_REL, "approved"),
      [PLAN_REL]: "# Demo Plan\n",
      ".apt/orchestration/progress.md": "- [x] a\n- [x] b\n",
      ".apt/verify/latest.md": "# Verify Report\n\n**Overall:** PASS\n",
    });
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: async () => ({
        anchor: { commit: "nogit", mode: "fileHashes" },
        new: ["src/new-file.ts"],
        modified: [],
        deleted: [],
        unregistered: [],
      }),
    });
    expect(status.phase).toBe("verifying");
    expect(status.loopDone).toBe(false);
    expect(status.nextAction).toBe("verify");
  });

  // Pins the "planning gated on tasks.total===0" behavior: an approved spec
  // with a plan present but no progress ledger yet stays in planning
  // (nextAction implement_plan) rather than advancing to implementing.
  it("approved spec + plan but no progress -> planning, implement_plan", async () => {
    await writeFiles(root, {
      ".apt/goal.md": "Ship demo.\n",
      [SPEC_REL]: LOW_RISK_SPEC,
      ".apt/approvals.json": approvedSpec(SPEC_REL, "approved"),
      [PLAN_REL]: "# Demo Plan\n",
    });
    const status = await aggregateStatus(root, {
      dbExists: stubs.dbOk,
      audit: stubs.auditClean,
    });
    expect(status.phase).toBe("planning");
    expect(status.nextAction).toBe("implement_plan");
    expect(status.tasks).toEqual({ total: 0, done: 0, blocked: 0 });
  });
});
