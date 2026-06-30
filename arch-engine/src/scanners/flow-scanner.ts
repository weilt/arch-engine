import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type {
  DocumentModel,
  FlowEdge,
  FlowGraph,
  FlowLayer,
  FlowNode,
  RouteEntry,
} from "../types.js";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Classify a backend java file into a flow layer by path/filename convention. */
function detectBackendLayer(absFile: string): FlowLayer | null {
  const p = absFile.replace(/\\/g, "/");
  if (/repository/i.test(p) || /Mapper\.java$/i.test(p)) return "repository";
  if (/service/i.test(p)) return "service";
  if (/controller/i.test(p)) return "controller";
  return null;
}

/** Extract the class/interface name, falling back to the file stem. */
function extractClassName(content: string, absFile: string): string {
  const classMatch = content.match(/public\s+(?:abstract\s+)?class\s+(\w+)/);
  if (classMatch) return classMatch[1];
  const ifaceMatch = content.match(/public\s+interface\s+(\w+)/);
  if (ifaceMatch) return ifaceMatch[1];
  return path.basename(absFile, ".java");
}

/**
 * Per-entity match confidence within a backend file.
 * "high" when the entity name appears in a method signature, an @Autowired
 * target, or a class field declaration; "low" when it only appears in method
 * bodies or comments.
 */
function classifyConfidence(content: string, entityName: string): "high" | "low" {
  const nameRe = new RegExp(`\\b${escapeRegExp(entityName)}\\b`);
  if (!nameRe.test(content)) return "low";
  for (const line of content.split(/\r?\n/)) {
    if (!nameRe.test(line)) continue;
    // Method signature: visibility keyword + parameter list.
    if (/\b(public|private|protected)\b/.test(line) && /\(/.test(line)) {
      return "high";
    }
    // @Autowired injection target.
    if (/@Autowired/.test(line)) {
      return "high";
    }
    // Class field declaration (ends in ; or = and carries a field modifier).
    if (/[;=]/.test(line) && /\b(private|protected|public|final|static)\b/.test(line)) {
      return "high";
    }
  }
  return "low";
}

function flattenRoutes(routes: RouteEntry[] | undefined): RouteEntry[] {
  const out: RouteEntry[] = [];
  if (!routes) return out;
  for (const r of routes) {
    out.push(r);
    if (r.children) out.push(...flattenRoutes(r.children));
  }
  return out;
}

function includesCi(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Derive a cross-layer FlowGraph connecting entity nodes to the backend
 * (repository/service/controller) and frontend (api-client/route/store) layers.
 *
 * Backend chain is scanned in batch (files iterated once, all entity names
 * tested per read) rather than per-entity; frontend chain reuses the contracts
 * already present in `model.packages`.
 */
export async function deriveFlowGraph(
  projectRoot: string,
  entityNames: string[],
  model: DocumentModel
): Promise<FlowGraph> {
  if (entityNames.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes = new Map<string, FlowNode>();
  const edgeKeys = new Set<string>();
  const edges: FlowEdge[] = [];

  const addNode = (node: FlowNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (
    from: string,
    to: string,
    confidence: "high" | "low",
    label?: string
  ): void => {
    const key = `${from}|${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, confidence, label });
  };

  // Step 1: entity nodes.
  for (const name of entityNames) {
    addNode({ id: `entity:${name}`, layer: "entity", name });
  }

  // Step 2: backend chain (batch scan per module).
  for (const module of model.modules) {
    const moduleDir = path.join(projectRoot, module.path);
    let javaFiles: string[] = [];
    try {
      javaFiles = await fg.glob("**/*.java", {
        cwd: moduleDir,
        absolute: true,
        ignore: ["**/target/**"],
      });
    } catch {
      javaFiles = [];
    }

    for (const absFile of javaFiles) {
      const layer = detectBackendLayer(absFile);
      if (!layer) continue;

      let content: string;
      try {
        content = await fs.readFile(absFile, "utf-8");
      } catch {
        continue;
      }

      const className = extractClassName(content, absFile);
      const relPath = path.relative(projectRoot, absFile).replace(/\\/g, "/");
      const nodeId = `${layer}:${className}`;
      addNode({
        id: nodeId,
        layer,
        name: className,
        filePath: relPath,
        moduleSlug: module.slug,
      });

      // Test every entity against this single read (batch optimisation).
      for (const entityName of entityNames) {
        const re = new RegExp(`\\b${escapeRegExp(entityName)}\\b`);
        if (!re.test(content)) continue;
        addEdge(`entity:${entityName}`, nodeId, classifyConfidence(content, entityName), layer);
      }
    }
  }

  // Step 3: frontend chain (reuse existing contracts, no re-scan).
  for (const pkg of model.packages) {
    if (pkg.apiClients) {
      for (const client of pkg.apiClients) {
        const nodeId = `api-client:${client.name}`;
        addNode({
          id: nodeId,
          layer: "api-client",
          name: client.name,
          filePath: client.file,
        });
        for (const entityName of entityNames) {
          if (client.endpoints.some((ep) => includesCi(ep.path, entityName))) {
            addEdge(`entity:${entityName}`, nodeId, "high", "api-client");
          }
        }
      }
    }

    for (const route of flattenRoutes(pkg.routes)) {
      const nodeId = `route:${route.path}`;
      addNode({
        id: nodeId,
        layer: "route",
        name: route.path,
        filePath: pkg.slug,
      });
      for (const entityName of entityNames) {
        if (includesCi(route.path, entityName)) {
          addEdge(`entity:${entityName}`, nodeId, "high", "route");
        }
      }
    }

    if (pkg.stores) {
      for (const store of pkg.stores) {
        const nodeId = `store:${store.name}`;
        addNode({
          id: nodeId,
          layer: "store",
          name: store.name,
          filePath: store.file,
        });
        const haystack = [
          store.name,
          ...store.state,
          ...store.getters,
          ...store.actions,
        ].join(" ");
        for (const entityName of entityNames) {
          if (includesCi(haystack, entityName)) {
            addEdge(`entity:${entityName}`, nodeId, "high", "store");
          }
        }
      }
    }
  }

  return { nodes: [...nodes.values()], edges };
}
