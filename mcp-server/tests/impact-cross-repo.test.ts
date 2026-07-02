import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleQueryImpact, type ImpactResult } from "../src/impact-query.js";

// v2.1.0: query_impact is workspace-aware. When the call graph spans multiple
// repos, edges crossing a repo boundary are annotated on `crossRepoEdges`.
// Fixtures are written straight into <tmp>/.ai/arch/ (no mocks), mirroring
// impact-query-callgraph.test.ts. Repo attribution is carried on the node's
// `moduleSlug` (repo/module form) here; the handler also accepts an explicit
// `repoSlug` field and a repo prefix embedded in the id.

function flowJson(nodes: unknown[], edges: unknown[]): string {
  return JSON.stringify({ nodes, edges });
}

function entitiesJson(relations: unknown[]): string {
  return JSON.stringify({ entities: [], relations });
}

async function writeFiles(
  root: string,
  files: Record<string, string>
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
  }
}

describe("handleQueryImpact cross-repo (v2.1.0)", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "apt-impact-xrepo-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("annotates call-graph edges that cross repo boundaries", async () => {
    // Order lives in the order-service repo; Payment lives in the
    // payment-service repo. One edge spans the two repos (the rest stay
    // within order-service) so crossRepoEdges should hold exactly that edge.
    await writeFiles(root, {
      ".ai/arch/flow.json": flowJson(
        [
          { id: "entity:Order", layer: "entity", name: "Order" },
          {
            id: "service:OrderService",
            layer: "service",
            name: "OrderService",
            moduleSlug: "order-service/orders",
          },
        ],
        [
          {
            from: "entity:Order",
            to: "service:OrderService",
            confidence: "high",
          },
        ]
      ),
      ".ai/arch/entities.json": entitiesJson([]),
      ".ai/arch/call-graph.json": JSON.stringify({
        nodes: [
          {
            id: "method:OrderService#create",
            kind: "method",
            name: "create",
            moduleSlug: "order-service/orders",
          },
          {
            id: "method:OrderService#internal",
            kind: "method",
            name: "internal",
            moduleSlug: "order-service/orders",
          },
          {
            id: "method:PaymentService#charge",
            kind: "method",
            name: "charge",
            moduleSlug: "payment-service/payments",
          },
        ],
        edges: [
          // cross-repo: order-service -> payment-service.
          {
            from: "method:OrderService#create",
            to: "method:PaymentService#charge",
            kind: "calls",
            confidence: "high",
          },
          // same-repo: must NOT appear in crossRepoEdges.
          {
            from: "method:OrderService#create",
            to: "method:OrderService#internal",
            kind: "calls",
            confidence: "high",
          },
        ],
      }),
    });

    const result = (await handleQueryImpact(root, "Order")) as ImpactResult;

    expect(result.crossRepoEdges).toBeDefined();
    expect(result.crossRepoEdges!.length).toBeGreaterThanOrEqual(1);
    // Exactly the one edge that leaves order-service for payment-service.
    expect(result.crossRepoEdges).toContainEqual({
      source: "method:OrderService#create",
      target: "method:PaymentService#charge",
      sourceRepo: "order-service",
      targetRepo: "payment-service",
    });
    // The same-repo edge is filtered out.
    expect(
      result.crossRepoEdges!.some(
        (e) => e.target === "method:OrderService#internal"
      )
    ).toBe(false);
    // Every reported edge carries both repo slugs.
    for (const edge of result.crossRepoEdges!) {
      expect(edge.sourceRepo).toBeDefined();
      expect(edge.targetRepo).toBeDefined();
    }
  });

  it("honors an explicit repoSlug field on nodes", async () => {
    // Same cross-repo shape, but repo attribution comes from an explicit
    // `repoSlug` field (present in the JSON even though the typed node has
    // no such field) rather than a repo/module moduleSlug.
    await writeFiles(root, {
      ".ai/arch/flow.json": flowJson(
        [{ id: "entity:Order", layer: "entity", name: "Order" }],
        []
      ),
      ".ai/arch/entities.json": entitiesJson([]),
      ".ai/arch/call-graph.json": JSON.stringify({
        nodes: [
          {
            id: "method:OrderService#create",
            kind: "method",
            name: "create",
            repoSlug: "orders",
          },
          {
            id: "method:InventoryService#reserve",
            kind: "method",
            name: "reserve",
            repoSlug: "inventory",
          },
        ],
        edges: [
          {
            from: "method:OrderService#create",
            to: "method:InventoryService#reserve",
            kind: "calls",
            confidence: "high",
          },
        ],
      }),
    });

    const result = (await handleQueryImpact(root, "Order")) as ImpactResult;

    expect(result.crossRepoEdges).toEqual([
      {
        source: "method:OrderService#create",
        target: "method:InventoryService#reserve",
        sourceRepo: "orders",
        targetRepo: "inventory",
      },
    ]);
  });

  it("omits crossRepoEdges for a single-repo call graph (backward compat)", async () => {
    // Legacy graph: no repo attribution on any node -> nothing resolves to a
    // repo -> no cross-repo edge -> field omitted, identical to v2.0.6.
    await writeFiles(root, {
      ".ai/arch/flow.json": flowJson(
        [
          { id: "entity:Order", layer: "entity", name: "Order" },
          {
            id: "service:OrderService",
            layer: "service",
            name: "OrderService",
            moduleSlug: "base",
          },
        ],
        [
          {
            from: "entity:Order",
            to: "service:OrderService",
            confidence: "high",
          },
        ]
      ),
      ".ai/arch/entities.json": entitiesJson([]),
      ".ai/arch/call-graph.json": JSON.stringify({
        nodes: [
          {
            id: "method:OrderService#create",
            kind: "method",
            name: "create",
            moduleSlug: "base",
          },
          {
            id: "method:OrderService#internal",
            kind: "method",
            name: "internal",
            moduleSlug: "base",
          },
        ],
        edges: [
          {
            from: "method:OrderService#create",
            to: "method:OrderService#internal",
            kind: "calls",
            confidence: "high",
          },
        ],
      }),
    });

    const result = (await handleQueryImpact(root, "Order")) as ImpactResult;

    // Entity/flow path still works...
    expect(result.layers.length).toBeGreaterThan(0);
    // ...and the new field stays absent for single-repo graphs.
    expect(result.crossRepoEdges).toBeUndefined();
  });

  it("omits crossRepoEdges when call-graph.json is missing (backward compat)", async () => {
    await writeFiles(root, {
      ".ai/arch/flow.json": flowJson(
        [{ id: "entity:Order", layer: "entity", name: "Order" }],
        []
      ),
      ".ai/arch/entities.json": entitiesJson([]),
      // call-graph.json intentionally absent.
    });

    const result = (await handleQueryImpact(root, "Order")) as ImpactResult;

    expect(result.crossRepoEdges).toBeUndefined();
  });
});