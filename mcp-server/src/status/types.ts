// Status types for the APT project status package.
// Pure type definitions: no runtime or IO dependencies.

// Spec section 4.2: lifecycle phase of a project.
export type Phase =
  | "idle"
  | "brainstorming"
  | "spec_pending_approval"
  | "planning"
  | "implementing"
  | "verifying"
  | "done"
  | "blocked";

// Spec section 3.3: the next concrete action recommended to the agent.
export type NextAction =
  | "auto_brainstorm"
  | "await_spec_approval"
  | "plan_from_spec"
  | "implement_plan"
  | "feature"
  | "verify"
  | "finish_feature"
  | "start_init"
  | "none";

export type SpecRisk = "low" | "high";

export type ApprovalState = "pending" | "approved" | "auto_approved";

export type VerifyResult = "PASS" | "FAIL" | "BLOCKED" | "none";

export interface TasksSummary {
  total: number;
  done: number;
  blocked: number;
}

export interface LastVerify {
  path: string;
  result: VerifyResult;
}

// Matches spec section 4.3 (ProjectStatus) exactly.
export interface ProjectStatus {
  phase: Phase;
  loopDone: boolean;
  nextAction: NextAction;
  goal?: string;
  activeSpec?: string;
  activePlan?: string;
  specRisk?: SpecRisk;
  specApproval?: ApprovalState;
  tasks?: TasksSummary;
  lastVerify?: LastVerify;
  blockers: string[];
  summary: string;
}

// Persisted to .apt/status.json (superset of the loop-critical fields with a timestamp).
export interface StatusSnapshot {
  phase: Phase;
  loopDone: boolean;
  nextAction: NextAction;
  updatedAt: string;
}
