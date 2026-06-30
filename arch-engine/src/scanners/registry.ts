import type { DocumentModel, EntityGraph, FlowGraph, JavaModule } from "../types.js";

export type ScannerPhase = "entity" | "flow" | "asset";

export interface ScannerContext {
  projectRoot: string;
  modules: JavaModule[];
  model: DocumentModel;
  entityNames?: string[];
}

export interface ScannerResult {
  entities?: Partial<EntityGraph>;
  flows?: Partial<FlowGraph>;
}

export interface ScannerPlugin {
  name: string;
  phase: ScannerPhase;
  scan(ctx: ScannerContext): Promise<ScannerResult>;
}

// Empty stub - will be filled in Task 4
export function createScannerRegistry(): ScannerPlugin[] {
  return [];
}
