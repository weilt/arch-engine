import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleQueryImpact, type ImpactResult } from "../src/impact-query.js";

// On-disk fixtures (no mocks): flow.json + entities.json written straight into
// <tmp>/.ai/arch/ where getArchDir resolves. Each test builds the minimal
// graph needed to exercise one branch of the three-level degradation.

interface FlowNodeLike {
  id: string;
  layer: string;
  name: string;
  filePath?: string;
  moduleSlug?: string;
}
interface FlowEdgeLike {
  from: string;
  to: string;
  confidence: "high" | "low";
  label?: string;
}

function flowJson(nodes: FlowNodeLike[], edges: FlowEdgeLike[]): string {
  return JSON.stringify({ nodes, edges });
}

function entitiesJson(
  relations: { from: string; to: string; kind: string; source: string }[]
): string {
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

const NODES = {
  orderEntity: { id: "entity:Order", layer: "entity", name: "Order" },
  orderService: {
    id: "service:OrderService",
    layer: "service",
    name: "OrderService",
    filePath: "svc/OrderService.java",
    moduleSlug: "base",
  },
  orderMapper: {
    id: "repository:OrderMapper",
    layer: "repository",
    name: "OrderMapper",
    filePath: "repo/OrderMapper.java",
    moduleSlug: "base",
  },
};

describe("handleQueryImpact", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "apt-impact-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("normal query groups references by layer and returns matching relations", async () => {
    await writeFiles(root, {
      ".ai/arch/flow.json": flowJson(
        [NODES.orderEntity, NODES.orderService, NODES.orderMapper],
        [
          { from: "entity:Order", to: "service:OrderService", confidence: "high" },
          { from: "entity:Order", to: "repository:OrderMapper", confidence: "low" },
        ]
      ),
      ".ai/arch/entities.json": entitiesJson([
        { from: "Order", to: "OrderItem", kind: "one-to-many", source: "jpa" },
        { from: "User", to: "Order", kind: "many-to-one", source: "jpa" },
        { from: "User", to: "Role", kind: "many-to-many", source: "jpa" },
      ]),
    });

    const result = (await handleQueryImpact(root, "Order")) as ImpactResult;

    // No error note on a healthy query.
    expect(result.note).toBeUndefined();
    expect(result.entity).toBe("Order");

    // Layers grouped, ordered repository (deeper) before service.
    expect(result.layers.map((l) => l.layer)).toEqual(["repository", "service"]);
    const repoRefs = result.layers[0]!.references;
    const svcRefs = result.layers[1]!.references;
    expect(repoRefs[0]!.name).toBe("OrderMapper");
    expect(svcRefs[0]!.name).toBe("OrderService");

    // Only relations touching Order are returned.
    expect(result.relations.map((r) => `${r.from}->${r.to}`).sort()).toEqual(["Order->OrderItem", "User->Order"]);
  });

  it("entity not found yields empty layers with an explanatory note", async () => {
    await writeFiles(root, {
      ".ai/arch/flow.json": flowJson(
        [NODES.orderEntity, NODES.orderService],
        [{ from: "entity:Order", to: "service:OrderService", confidence: "high" }]
      ),
    });

    const result = await handleQueryImpact(root, "NonExistent");
    expect(result).toMatchObject({
      entity: "NonExistent",
      layers: [],
      relations: [],
      note: "entity not found",
    });
  });

  it("missing flow.json reports the index as not built", async () => {
    const result = await handleQueryImpact(root, "Order");
    expect(result).toMatchObject({
      entity: "Order",
      layers: [],
      relations: [],
      note: "entity/flow index not built",
    });
  });

  it("corrupt flow.json reports the index as corrupt", async () => {
    await writeFiles(root, {
      ".ai/arch/flow.json": "{ not valid json }}}",
    });

    const result = await handleQueryImpact(root, "Order");
    expect(result).toMatchObject({
      entity: "Order",
      layers: [],
      relations: [],
      note: "index corrupt, rerun start-init",
    });
  });

  it("orders references within a layer high-confidence before low", async () => {
    const highNode = {
      id: "repository:OrderHighMapper",
      layer: "repository",
      name: "OrderHighMapper",
    };
    const lowNode = {
      id: "repository:OrderLowMapper",
      layer: "repository",
      name: "OrderLowMapper",
    };
    // Declare low before high in the edge list to prove ordering is by
    // confidence, not by file order.
    await writeFiles(root, {
      ".ai/arch/flow.json": flowJson(
        [NODES.orderEntity, lowNode, highNode],
        [
          { from: "entity:Order", to: "repository:OrderLowMapper", confidence: "low" },
          { from: "entity:Order", to: "repository:OrderHighMapper", confidence: "high" },
        ]
      ),
    });

    const result = (await handleQueryImpact(root, "Order")) as ImpactResult;

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]!.layer).toBe("repository");
    const names = result.layers[0]!.references.map((r) => r.name);
    expect(names).toEqual(["OrderHighMapper", "OrderLowMapper"]);
  });

  it("never throws when entities.json is missing alongside a valid flow.json", async () => {
    await writeFiles(root, {
      ".ai/arch/flow.json": flowJson(
        [NODES.orderEntity, NODES.orderService],
        [{ from: "entity:Order", to: "service:OrderService", confidence: "high" }]
      ),
      // entities.json intentionally absent
    });

    const result = (await handleQueryImpact(root, "Order")) as ImpactResult;
    expect(result.relations).toEqual([]);
    expect(result.layers).toHaveLength(1);
  });
});
