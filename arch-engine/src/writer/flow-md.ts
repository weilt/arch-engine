import fs from "node:fs/promises";
import path from "node:path";
import { getArchDir } from "../paths.js";
import type { FlowEdge, FlowGraph, FlowLayer } from "../types.js";

const LAYER_ORDER: FlowLayer[] = [
  "entity",
  "repository",
  "service",
  "controller",
  "api-client",
  "route",
  "store",
];

function titleCaseLayer(layer: FlowLayer): string {
  return layer.charAt(0).toUpperCase() + layer.slice(1);
}

function renderEdgeLine(edge: FlowEdge): string {
  const base = `- ${edge.from} → ${edge.to} (confidence: ${edge.confidence})`;
  return edge.label ? `${base} ${edge.label}` : base;
}

function renderFlowMarkdown(graph: FlowGraph): string {
  const lines: string[] = ["# Data Flow", ""];

  if (graph.edges.length === 0) {
    lines.push("_No flows discovered._", "");
    return lines.join("\n").trimEnd() + "\n";
  }

  const layerOf = new Map<string, FlowLayer>();
  for (const node of graph.nodes) {
    layerOf.set(node.id, node.layer);
  }

  const grouped = new Map<FlowLayer, FlowEdge[]>();
  const orphan: FlowEdge[] = [];
  for (const edge of graph.edges) {
    const layer = layerOf.get(edge.from) ?? layerOf.get(edge.to);
    if (layer) {
      const list = grouped.get(layer) ?? [];
      list.push(edge);
      grouped.set(layer, list);
    } else {
      orphan.push(edge);
    }
  }

  for (const layer of LAYER_ORDER) {
    const edges = grouped.get(layer);
    if (!edges || edges.length === 0) continue;
    lines.push(`## ${titleCaseLayer(layer)}`, "");
    for (const edge of edges) {
      lines.push(renderEdgeLine(edge));
    }
    lines.push("");
  }

  if (orphan.length > 0) {
    lines.push("## Other", "");
    for (const edge of orphan) {
      lines.push(renderEdgeLine(edge));
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}

export async function writeFlowDocs(
  projectRoot: string,
  graph: FlowGraph,
): Promise<void> {
  const dir = getArchDir(projectRoot);
  await atomicWrite(path.join(dir, "flow.md"), renderFlowMarkdown(graph));
  await atomicWrite(
    path.join(dir, "flow.json"),
    JSON.stringify(graph, null, 2),
  );
}
