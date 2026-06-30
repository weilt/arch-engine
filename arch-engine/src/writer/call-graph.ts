import fs from "node:fs/promises";
import path from "node:path";
import { getArchDir } from "../paths.js";
import type { CallGraph, CallGraphNode, CallGraphEdge } from "../types.js";

// Node id prefixes emitted by the call-graph scanners. Frontend components are
// stored with kind "method" but a "component:" id, so the prefix (not kind) is
// the reliable grouping signal for the markdown summary.
const METHOD_PREFIX = "method:";
const DTO_PREFIX = "dto:";
const COMPONENT_PREFIX = "component:";

const NODE_SECTIONS: Array<{
  title: string;
  match: (node: CallGraphNode) => boolean;
}> = [
  { title: "Methods", match: (n) => n.id.startsWith(METHOD_PREFIX) },
  { title: "Frontend Components", match: (n) => n.id.startsWith(COMPONENT_PREFIX) },
  { title: "DTOs", match: (n) => n.id.startsWith(DTO_PREFIX) },
];

const EDGE_SECTIONS: Array<{
  title: string;
  kind: CallGraphEdge["kind"];
}> = [
  { title: "Calls", kind: "calls" },
  { title: "Imports", kind: "imports" },
  { title: "Uses", kind: "uses" },
  { title: "Template", kind: "template" },
];

function renderNodeLine(node: CallGraphNode): string[] {
  const lines: string[] = [`- \`${node.id}\``];
  const detail: string[] = [];
  if (node.filePath) detail.push(node.filePath);
  if (node.moduleSlug) detail.push(`module: ${node.moduleSlug}`);
  if (node.layer) detail.push(`layer: ${node.layer}`);
  if (node.signature) detail.push(`signature: ${node.signature}`);
  if (node.annotations && node.annotations.length > 0) {
    detail.push(`annotations: ${node.annotations.join(", ")}`);
  }
  if (node.fields && node.fields.length > 0) {
    detail.push(`fields: ${node.fields.map((f) => `${f.name}: ${f.type}`).join(", ")}`);
  }
  if (detail.length > 0) lines.push(`  - ${detail.join(" | ")}`);
  return lines;
}

function renderEdgeLine(edge: CallGraphEdge): string {
  return `- \`${edge.from}\` -> \`${edge.to}\` (confidence: ${edge.confidence})`;
}

function renderCallGraphMarkdown(graph: CallGraph): string {
  const lines: string[] = ["# Call Graph", ""];

  if (graph.nodes.length === 0 && graph.edges.length === 0) {
    lines.push("_No call-graph discovered._", "");
    return lines.join("\n").trimEnd() + "\n";
  }

  // --- Nodes, grouped by id-prefix kind ---
  lines.push(`## Nodes (${graph.nodes.length})`, "");
  let printedNodeSection = false;
  for (const section of NODE_SECTIONS) {
    const nodes = graph.nodes.filter(section.match);
    if (nodes.length === 0) continue;
    printedNodeSection = true;
    lines.push(`### ${section.title} (${nodes.length})`, "");
    for (const node of nodes) {
      lines.push(...renderNodeLine(node));
    }
    lines.push("");
  }
  // Any node that matches none of the known prefixes (defensive).
  const known = new Set<string>();
  for (const node of graph.nodes) {
    if (NODE_SECTIONS.some((s) => s.match(node))) known.add(node.id);
  }
  const otherNodes = graph.nodes.filter((n) => !known.has(n.id));
  if (otherNodes.length > 0) {
    printedNodeSection = true;
    lines.push(`### Other (${otherNodes.length})`, "");
    for (const node of otherNodes) {
      lines.push(...renderNodeLine(node));
    }
    lines.push("");
  }
  if (!printedNodeSection) {
    lines.push("_No nodes._", "");
  }

  // --- Edges, grouped by kind ---
  lines.push(`## Edges (${graph.edges.length})`, "");
  let printedEdgeSection = false;
  for (const section of EDGE_SECTIONS) {
    const edges = graph.edges.filter((e) => e.kind === section.kind);
    if (edges.length === 0) continue;
    printedEdgeSection = true;
    lines.push(`### ${section.title} (${edges.length})`, "");
    for (const edge of edges) {
      lines.push(renderEdgeLine(edge));
    }
    lines.push("");
  }
  if (!printedEdgeSection) {
    lines.push("_No edges._", "");
  }

  return lines.join("\n").trimEnd() + "\n";
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}

export async function writeCallGraph(
  projectRoot: string,
  graph: CallGraph,
): Promise<void> {
  const dir = getArchDir(projectRoot);
  await atomicWrite(
    path.join(dir, "call-graph.json"),
    JSON.stringify(graph, null, 2),
  );
  await atomicWrite(
    path.join(dir, "call-graph.md"),
    renderCallGraphMarkdown(graph),
  );
}
