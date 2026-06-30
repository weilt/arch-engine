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
import type { FlowNode, FlowEdge, EntityRelation } from "@apt/arch-engine";

export interface ImpactLayer {
  layer: string;
  references: FlowNode[];
}

export interface ImpactResult {
  entity: string;
  layers: ImpactLayer[];
  relations: EntityRelation[];
  note?: string;
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

export async function handleQueryImpact(
  projectRoot: string,
  entity: string
): Promise<ImpactResult> {
  const archDir = getArchDir(projectRoot);
  const flowPath = path.join(archDir, "flow.json");
  const entitiesPath = path.join(archDir, "entities.json");

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

  // Degradation level 3: entity not found. "Found" means the entity node
  // exists OR some edge references it (robust to nodes being pruned).
  if (!nodeById.has(entityId) && touching.length === 0) {
    return EMPTY(entity, "entity not found");
  }

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

  return { entity, layers, relations };
}
