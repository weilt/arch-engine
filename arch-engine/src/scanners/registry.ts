import type { DocumentModel, EntityGraph, FlowGraph, JavaModule } from "../types.js";
import { scanJpaEntities } from "./entity-jpa.js";
import { scanMybatisEntities } from "./entity-mybatis.js";
import { scanSqlEntities } from "./entity-sql.js";
import { deriveFlowGraph } from "./flow-scanner.js";

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

export function createScannerRegistry(): ScannerPlugin[] {
  return [
    // Entity phase: JPA scanner
    {
      name: "entity-jpa",
      phase: "entity",
      async scan(ctx) {
        const result = await scanJpaEntities(ctx.projectRoot, ctx.modules);
        return { entities: result };
      },
    },
    // Entity phase: MyBatis scanner
    {
      name: "entity-mybatis",
      phase: "entity",
      async scan(ctx) {
        const result = await scanMybatisEntities(ctx.projectRoot, ctx.modules);
        return { entities: result };
      },
    },
    // Entity phase: SQL scanner
    {
      name: "entity-sql",
      phase: "entity",
      async scan(ctx) {
        const result = await scanSqlEntities(ctx.projectRoot);
        return { entities: result };
      },
    },
    // Flow phase: flow graph derivation (depends on entityNames from entity phase)
    {
      name: "flow-derive",
      phase: "flow",
      async scan(ctx) {
        if (!ctx.entityNames || ctx.entityNames.length === 0) {
          return {};
        }
        const flows = await deriveFlowGraph(ctx.projectRoot, ctx.entityNames, ctx.model);
        return { flows };
      },
    },
  ];
}
