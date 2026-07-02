import type {
  CallGraph,
  CallGraphEdge,
  CallGraphNode,
  DocumentModel,
  EntityDef,
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
import { scanGoSources } from "./go-scanner.js";
import { scanPythonSources } from "./python-scanner.js";

export type ScannerPhase = "entity" | "flow" | "asset" | "call-graph";

export interface ScannerContext {
  projectRoot: string;
  modules: JavaModule[];
  model: DocumentModel;
  entityNames?: string[];
  packageDirs?: Map<string, string>;
  packages?: FrontendPackage[];
  repoSlug?: string;
  repoLang?: string;
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
        if (ctx.repoLang && ctx.repoLang !== "java") return {};
        const result = await scanJpaEntities(ctx.projectRoot, ctx.modules);
        return { entities: result };
      },
    },
    // Entity phase: MyBatis scanner
    {
      name: "entity-mybatis",
      phase: "entity",
      async scan(ctx) {
        if (ctx.repoLang && ctx.repoLang !== "java") return {};
        const result = await scanMybatisEntities(ctx.projectRoot, ctx.modules);
        return { entities: result };
      },
    },
    // Entity phase: SQL scanner
    {
      name: "entity-sql",
      phase: "entity",
      async scan(ctx) {
        if (ctx.repoLang && ctx.repoLang !== "java") return {};
        const result = await scanSqlEntities(ctx.projectRoot);
        return { entities: result };
      },
    },
    // Entity phase: Go scanner (Go repos only)
    {
      name: "go-scanner",
      phase: "entity",
      async scan(ctx) {
        if (!ctx.repoLang || ctx.repoLang !== "go") return {};
        const result = await scanGoSources(ctx.projectRoot, ctx.repoSlug!);
        const entities: EntityDef[] = result.structs.map((s) => ({
          name: s.name,
          table: s.name,
          moduleSlug: s.moduleSlug,
          filePath: s.filePath,
          fields: s.fields.map((f) => ({ name: f.name, type: f.type })),
          source: "sql",
        }));
        const nodes: CallGraphNode[] = result.methods.map((m) => ({
          id: m.id,
          kind: "method",
          name: m.receiver ? `${m.receiver}.${m.name}` : m.name,
          filePath: m.filePath,
          moduleSlug: m.moduleSlug,
          signature: m.signature,
        }));
        const edges: CallGraphEdge[] = result.callEdges.map((e) => ({
          from: e.source,
          to: e.target,
          kind: "calls",
          confidence: "high",
        }));
        return {
          entities: { entities, relations: [] },
          callGraph: { nodes, edges },
        };
      },
    },
    // Entity phase: Python scanner (Python repos only)
    {
      name: "python-scanner",
      phase: "entity",
      async scan(ctx) {
        if (!ctx.repoLang || ctx.repoLang !== "python") return {};
        const result = await scanPythonSources(
          ctx.projectRoot,
          ctx.repoSlug!,
        );
        const entities: EntityDef[] = result.classes
          .filter((c) => c.ormType !== "none")
          .map((c) => ({
            name: c.name,
            table: c.tableName ?? c.name,
            moduleSlug: c.moduleSlug,
            filePath: c.filePath,
            fields: c.fields.map((f) => ({ name: f.name, type: f.type })),
            source: "sql",
          }));
        const nodes: CallGraphNode[] = result.methods.map((m) => ({
          id: m.id,
          kind: "method",
          name: m.className ? `${m.className}.${m.name}` : m.name,
          filePath: m.filePath,
          moduleSlug: m.moduleSlug,
          signature: m.signature,
        }));
        const edges: CallGraphEdge[] = result.callEdges.map((e) => ({
          from: e.source,
          to: e.target,
          kind: "calls",
          confidence: "high",
        }));
        return {
          entities: { entities, relations: [] },
          callGraph: { nodes, edges },
        };
      },
    },
    // Flow phase: flow graph derivation (depends on entityNames from entity phase)
    {
      name: "flow-derive",
      phase: "flow",
      async scan(ctx) {
        if (ctx.repoLang && ctx.repoLang !== "java") return {};
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
        if (ctx.repoLang && ctx.repoLang !== "java") return {};
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
        if (ctx.repoLang && ctx.repoLang !== "ts") return {};
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
