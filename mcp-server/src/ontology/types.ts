// Ontology types for the APT query_ontology tool.
// Pure type definitions: no runtime or IO dependencies.
// Reused types are imported (type-only) from the status package and the
// arch-engine package; see spec section 3.2 for the snapshot contract.

import type {
  Phase,
  NextAction,
  SpecRisk,
  ApprovalState,
} from "../status/types.js";
import type { SearchHit, EntityRelation } from "@apt/arch-engine";

// Lightweight project metadata surfaced in the ontology snapshot.
export interface ProjectMeta {
  name?: string;
  techStack?: string[];
}

// Per-scope counts of architecture assets by kind. Every kind is optional so a
// snapshot can omit kinds that have no assets.
export interface OntologyAssetCount {
  api?: number;
  rpc?: number;
  util?: number;
  enum?: number;
  pojo?: number;
  starter?: number;
  component?: number;
  apiClient?: number;
  route?: number;
  store?: number;
}

// Ontology view of a single backend module.
export interface ModuleOntology {
  slug: string;
  name: string;
  assetCounts: OntologyAssetCount;
}

// Ontology view of a single frontend package.
export interface PackageOntology {
  slug: string;
  name: string;
  framework?: string;
  assetCounts: OntologyAssetCount;
}

// A registered dependency contract: its name plus the TS source file path.
export interface OntologyContract {
  name: string;
  tsFile: string;
}

// Design-system coverage surfaced in the ontology snapshot.
export interface OntologyDesign {
  hasTokens: boolean;
  hasBindings: boolean;
  pages: string[];
  components: string[];
}

// Spec risk + approval state, reused from the status package.
export interface OntologyApprovalState {
  specRisk?: SpecRisk;
  state?: ApprovalState;
}

// Loop progress surfaced in the ontology snapshot.
export interface OntologyProgress {
  currentTask?: string;
  doneCount: number;
  totalCount: number;
}

// Loop status fields surfaced in the ontology snapshot.
export interface OntologyStatus {
  phase: Phase;
  loopDone: boolean;
  nextAction: NextAction;
  activeGoal?: string;
}

// Structural topology metrics surfaced in the ontology snapshot (v2.0.4).
export interface OntologyTopology {
  moduleCount: number;
  rpcEndpoints: number;
  entityCount: number;
  flowEdgeCount: number;
  crossServiceRefs: number;
  // v2.0.5: call-graph metrics (omitted when not computed).
  methodCount?: number;
  dtoCount?: number;
  callEdgeCount?: number;
  importEdgeCount?: number;
}

// Full project ontology snapshot (spec section 3.2).
export interface ProjectOntology {
  project: ProjectMeta | null;
  status: OntologyStatus;
  progress?: OntologyProgress;
  modules: ModuleOntology[];
  packages: PackageOntology[];
  contracts: OntologyContract[];
  design?: OntologyDesign;
  approvalState?: OntologyApprovalState;
  /** v2.0.3: Entity relations from entities.json (omitted when not built). */
  relations?: EntityRelation[];
  /** v2.0.4: structural topology metrics (omitted when not computed). */
  topology?: OntologyTopology;
}

// Result of looking up a single topic across the project ontology.
export interface OntologyTopicResult {
  topic: string;
  matchedIn: string[];
  assets: SearchHit[];
  contracts: OntologyContract[];
  designPages?: string[];
  entities?: string[];
  flowSummary?: { nodes: number; edges: number };
  // v2.0.5: call-graph method/DTO drill-down (omitted when not computed).
  methods?: number;
  dtos?: number;
}
