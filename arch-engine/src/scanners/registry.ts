import type {
  CallGraph,
  DocumentModel,
  EntityGraph,
  FlowGraph,
  FrontendPackage,
  JavaModule,
} from "../types.js";
import { scanJpaEntities } from "./entity-jpa.js";
import { scanMybatisEntities } from "./entity-mybatis.js";
import { scanSqlEntities } from "./entity-sql.js";
import { deriveFlowGraph } from "./flow-scanner.js";
import { scanCallGraphJava } from "./call-graph-java.js";
import { scanCallGraphFrontend } from "./call-graph-frontend.js";

export type ScannerPhase = "entity" | "flow" | "asset" | "call-graph";

export interface ScannerContext {
  projectRoot: string;
  modules: JavaModule[];
  model: DocumentModel;
  entityNames?: string[];
  packageDirs?: Map<string, string>;
  packages?: FrontendPackage[];
}

export interface ScannerResult {
  entities?: Partial<EntityGraph>;
  flows?: Partial<FlowGraph>;
  callGraph?: CallGraph;
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
    // Call-graph phase: Java method/DTO graph (depends on modules).
    {
      name: "call-graph-java",
      phase: "call-graph",
      async scan(ctx) {
        const result = await scanCallGraphJava(
          ctx.projectRoot,
          ctx.modules,
          ctx.model,
        );
        return { callGraph: result };
      },
    },
    // Call-graph phase: frontend component graph (depends on packageDirs).
    {
      name: "call-graph-frontend",
      phase: "call-graph",
      async scan(ctx) {
        if (!ctx.packageDirs) return {};
        const result = await scanCallGraphFrontend(
          ctx.projectRoot,
          ctx.packageDirs,
          ctx.packages ?? ctx.model.packages,
        );
        return { callGraph: result };
      },
    },
  ];
}
