// Core handler for the `query_impact` MCP tool. Answers "what layers
// reference a given entity?" for change-scoping, grouping every FlowNode
// connected to the entity by layer (entity/repo/service/controller/frontend)
// and attaching the entity's relations from entities.json.
//
// Fault-tolerant by design: it NEVER throws. Missing/corrupt flow.json is
// communicated via the `note` field with empty data rather than an error,
// so callers always get a structured ImpactResult to reason over.
import fs from "node:fs/promises";
import path from "node:path";
import { getArchDir } from "@apt/arch-engine";
import type {
  FlowNode,
  FlowEdge,
  EntityRelation,
  CallGraphNode,
  CallGraphEdge,
} from "@apt/arch-engine";

export interface ImpactLayer {
  layer: string;
  references: FlowNode[];
}

export interface ImpactResult {
  entity: string;
  layers: ImpactLayer[];
  relations: EntityRelation[];
  note?: string;
  // v2.0.5 call-graph layer (all optional; omitted when call-graph.json is
  // missing/corrupt or when nothing matches).
  dto?: { fields: { name: string; type: string }[]; usedBy: string[] };
  method?: { callers: string[]; callees: string[]; annotations: string[] };
  component?: { importers: string[]; imports: string[]; templateUsers: string[] };
  graphReferences?: string[];
}

// Canonical layer ordering, deepest-first so impact reads bottom-up:
// the entity anchor, then up the backend chain, then the frontend chain.
const LAYER_ORDER = [
  "entity",
  "repository",
  "service",
  "controller",
  "rpc",
  "api-client",
  "route",
  "store",
] as const;

// Unknown layers (should not happen with well-formed flow.json) sink to the
// end rather than disappearing.
function layerRank(layer: string): number {
  const idx = LAYER_ORDER.indexOf(layer as (typeof LAYER_ORDER)[number]);
  return idx === -1 ? LAYER_ORDER.length : idx;
}

// "high" confidence ranks before "low"; treat anything malformed as low.
function confidenceRank(c: string | undefined): number {
  return c === "high" ? 0 : 1;
}

const EMPTY = (entity: string, note: string): ImpactResult => ({
  entity,
  layers: [],
  relations: [],
  note,
});

// ---------------------------------------------------------------------------
// v2.0.5 call-graph matching helpers.
//
// Each helper returns undefined when nothing matches, so the caller can omit
// the field entirely. Component nodes carry a `component:` id prefix at
// runtime even though the typed node-kind union is method|dto, so components
// are matched by id rather than kind.
// ---------------------------------------------------------------------------

// DTO: its field list plus every method that "uses" it.
function matchDto(
  entity: string,
  nodes: CallGraphNode[],
  edges: CallGraphEdge[]
): { fields: { name: string; type: string }[]; usedBy: string[] } | undefined {
  const node = nodes.find(
    (n) =>
      !!n &&
      n.kind === "dto" &&
      (n.id === `dto:${entity}` || n.name === entity)
  );
  if (!node) return undefined;
  const fields = Array.isArray(node.fields) ? node.fields : [];
  const usedBy = edges
    .filter((e) => !!e && e.kind === "uses" && e.to === node.id)
    .map((e) => e.from);
  return { fields, usedBy };
}

// Method (dotted "Class.method" or a bare name): reverse callers, forward
// callees, and the method's own annotations.
function matchMethod(
  entity: string,
  nodes: CallGraphNode[],
  edges: CallGraphEdge[]
): { callers: string[]; callees: string[]; annotations: string[] } | undefined {
  let methodId: string | undefined;
  const dot = entity.indexOf(".");
  if (dot !== -1) {
    methodId = `method:${entity.slice(0, dot)}#${entity.slice(dot + 1)}`;
  }
  const node = nodes.find((n) => {
    if (!n || n.kind !== "method") return false;
    return (methodId !== undefined && n.id === methodId) || n.name === entity;
  });
  if (!node) return undefined;
  const callers = edges
    .filter((e) => !!e && e.kind === "calls" && e.to === node.id)
    .map((e) => e.from);
  const callees = edges
    .filter((e) => !!e && e.kind === "calls" && e.from === node.id)
    .map((e) => e.to);
  const annotations = Array.isArray(node.annotations) ? node.annotations : [];
  return { callers, callees, annotations };
}

// Frontend component: reverse importers, forward imports, and reverse
// template users.
function matchComponent(
  entity: string,
  nodes: CallGraphNode[],
  edges: CallGraphEdge[]
):
  | { importers: string[]; imports: string[]; templateUsers: string[] }
  | undefined {
  const id = `component:${entity}`;
  const node = nodes.find((n) => {
    if (!n || typeof n.id !== "string") return false;
    return (
      n.id === id || (n.id.startsWith("component:") && n.name === entity)
    );
  });
  if (!node) return undefined;
  const importers = edges
    .filter((e) => !!e && e.kind === "imports" && e.to === node.id)
    .map((e) => e.from);
  const imports = edges
    .filter((e) => !!e && e.kind === "imports" && e.from === node.id)
    .map((e) => e.to);
  const templateUsers = edges
    .filter((e) => !!e && e.kind === "template" && e.to === node.id)
    .map((e) => e.from);
  return { importers, imports, templateUsers };
}

// Loose cross-graph reference: DTOs/methods whose name mentions the queried
// entity, surfaced alongside flow layers for fuller impact scoping. Omitted
// when empty.
function collectGraphReferences(
  entity: string,
  nodes: CallGraphNode[]
): string[] {
  const refs: string[] = [];
  for (const n of nodes) {
    if (!n || (n.kind !== "method" && n.kind !== "dto")) continue;
    if (typeof n.name === "string" && n.name.includes(entity)) {
      refs.push(n.id);
    }
  }
  return refs;
}

export async function handleQueryImpact(
  projectRoot: string,
  entity: string
): Promise<ImpactResult> {
  const archDir = getArchDir(projectRoot);
  const flowPath = path.join(archDir, "flow.json");
  const entitiesPath = path.join(archDir, "entities.json");
  const callGraphPath = path.join(archDir, "call-graph.json");

  // Degradation level 1: flow.json missing -> the entity/flow index has not
  // been built (start-init not run). Report empty, not an error.
  let flowRaw: string;
  try {
    flowRaw = await fs.readFile(flowPath, "utf-8");
  } catch {
    return EMPTY(entity, "entity/flow index not built");
  }

  // Degradation level 2: flow.json present but corrupt JSON. Ask the caller
  // to rerun start-init; we cannot trust partial data.
  let nodes: FlowNode[];
  let edges: FlowEdge[];
  try {
    const parsed = JSON.parse(flowRaw) as { nodes?: FlowNode[]; edges?: FlowEdge[] };
    nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    edges = Array.isArray(parsed.edges) ? parsed.edges : [];
  } catch {
    return EMPTY(entity, "index corrupt, rerun start-init");
  }

  // Index nodes by id so we can resolve the far endpoint of a touching edge.
  const nodeById = new Map<string, FlowNode>();
  for (const node of nodes) {
    if (node && typeof node.id === "string") nodeById.set(node.id, node);
  }

  const entityId = `entity:${entity}`;

  // An edge "touches" the entity when either endpoint is the entity node id.
  const touching = edges.filter(
    (e) => e && (e.from === entityId || e.to === entityId)
  );

  // "Found" means the entity node exists OR some edge references it (robust
  // to nodes being pruned). The not-found decision is deferred until after
  // call-graph matching so method/dto/component-only targets still resolve.
  const entityFound = nodeById.has(entityId) || touching.length > 0;

  // For each touching edge, the "reference" is the non-entity endpoint.
  // Track the highest confidence across all edges linking a given node so a
  // single "high" signal wins (high > low).
  const bestConfidence = new Map<string, "high" | "low">();
  const connected = new Map<string, FlowNode>();
  for (const edge of touching) {
    const otherId = edge.from === entityId ? edge.to : edge.from;
    if (otherId === entityId) continue; // self-loop is not a cross-layer reference
    const node = nodeById.get(otherId);
    if (!node) continue; // edge points at an unresolvable node id
    if (!connected.has(otherId)) connected.set(otherId, node);
    if (bestConfidence.get(otherId) !== "high") {
      bestConfidence.set(otherId, edge.confidence === "high" ? "high" : "low");
    }
  }

  // Group references by layer.
  const byLayer = new Map<string, FlowNode[]>();
  for (const node of connected.values()) {
    const layer = node.layer ?? "other";
    const list = byLayer.get(layer);
    if (list) list.push(node);
    else byLayer.set(layer, [node]);
  }

  // Build output: sort layers by canonical order, and within each layer sort
  // references high-confidence-first.
  const layers: ImpactLayer[] = [...byLayer.entries()]
    .map(([layer, refs]) => ({
      layer,
      references: refs.sort(
        (a, b) =>
          confidenceRank(bestConfidence.get(a.id)) -
          confidenceRank(bestConfidence.get(b.id))
      ),
    }))
    .sort((a, b) => layerRank(a.layer) - layerRank(b.layer));

  // Relations: filter entities.json to rows touching this entity. A missing
  // or corrupt entities.json is silent -> empty relations, never an error.
  let relations: EntityRelation[] = [];
  try {
    const raw = await fs.readFile(entitiesPath, "utf-8");
    const parsed = JSON.parse(raw) as { relations?: EntityRelation[] };
    if (Array.isArray(parsed.relations)) {
      relations = parsed.relations.filter(
        (r) => r && (r.from === entity || r.to === entity)
      );
    }
  } catch {
    relations = [];
  }

  // --- v2.0.5 call-graph layer ------------------------------------------------
  // Fault-tolerant read mirroring flow.json: a missing/corrupt call-graph.json
  // is silent -- all new fields stay omitted while entity/flow results are
  // returned intact.
  let cgNodes: CallGraphNode[] = [];
  let cgEdges: CallGraphEdge[] = [];
  try {
    const cgRaw = await fs.readFile(callGraphPath, "utf-8");
    const parsed = JSON.parse(cgRaw) as {
      nodes?: CallGraphNode[];
      edges?: CallGraphEdge[];
    };
    cgNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    cgEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
  } catch {
    // missing/corrupt -> omit new fields, keep existing results
  }

  const dtoMatch = matchDto(entity, cgNodes, cgEdges);
  const methodMatch = matchMethod(entity, cgNodes, cgEdges);
  const componentMatch = matchComponent(entity, cgNodes, cgEdges);
  const hasCallGraphMatch =
    dtoMatch !== undefined ||
    methodMatch !== undefined ||
    componentMatch !== undefined;

  // Degradation level 3: neither the flow graph nor the call graph know this
  // target.
  if (!entityFound && !hasCallGraphMatch) {
    return EMPTY(entity, "entity not found");
  }

  const result: ImpactResult = { entity, layers, relations };
  if (dtoMatch) result.dto = dtoMatch;
  if (methodMatch) result.method = methodMatch;
  if (componentMatch) result.component = componentMatch;
  // graphReferences belongs to the entity path: only when the target is also
  // a real flow-graph entity do we surface call-graph symbols mentioning it.
  if (entityFound) {
    const graphReferences = collectGraphReferences(entity, cgNodes);
    if (graphReferences.length > 0) result.graphReferences = graphReferences;
  }
  return result;
}
