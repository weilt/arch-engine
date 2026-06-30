import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleQueryOntology } from "../src/ontology-query.js";

const ARCH_INDEX = {
  root: "root",
  nodes: {
    root: {
      path: "root",
      kind: "root",
      title: "Architecture",
      summary: "",
      children: ["backend/orders", "backend/billing"],
      chunks: [],
      keywords: [],
    },
    "backend/orders": {
      path: "backend/orders",
      kind: "module",
      title: "Orders",
      summary: "Orders module",
      children: [],
      chunks: [],
      keywords: ["orders"],
    },
    "backend/billing": {
      path: "backend/billing",
      kind: "module",
      title: "Billing",
      summary: "Billing module",
      children: [],
      chunks: [],
      keywords: ["billing"],
    },
  },
};

const LAST_SCAN = {
  version: 2,
  commit: "nogit",
  branch: "",
  scannedAt: "",
  modules: {},
  packages: {},
};

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

async function writeBaseFixture(root: string): Promise<void> {
  await writeFiles(root, {
    ".ai/arch/backend/orders/utils.md": "## OrderUtil\n\nA util.\n",
    ".ai/db.json": JSON.stringify({ contracts: [], missingRequests: [] }),
    ".ai/arch/arch-index.json": JSON.stringify(ARCH_INDEX),
    ".ai/arch/last-scan.json": JSON.stringify(LAST_SCAN),
  });
}

type TopicResult = {
  matchedIn: string[];
  entities?: string[];
  flowSummary?: { nodes: number; edges: number };
  // v2.0.5: call-graph method/DTO drill-down (omitted when not computed).
  methods?: number;
  dtos?: number;
};

async function topic(root: string, t: string): Promise<TopicResult> {
  return (await handleQueryOntology(root, t)) as TopicResult;
}

describe("queryTopic drill-down", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "apt-topic-drill-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("matches a module slug and returns entities + flowSummary", async () => {
    await writeBaseFixture(root);
    await writeFiles(root, {
      ".ai/arch/entities.json": JSON.stringify({
        entities: [
          { name: "Order", moduleSlug: "orders" },
          { name: "OrderItem", moduleSlug: "orders" },
          { name: "Invoice", moduleSlug: "billing" },
        ],
        relations: [],
      }),
      ".ai/arch/flow.json": JSON.stringify({
        nodes: [
          { id: "entity:Order", layer: "entity", name: "Order", moduleSlug: "orders" },
          { id: "service:OrderService", layer: "service", name: "OrderService", moduleSlug: "orders" },
          { id: "entity:Invoice", layer: "entity", name: "Invoice", moduleSlug: "billing" },
        ],
        edges: [
          { from: "entity:Order", to: "service:OrderService", confidence: "high" },
          { from: "entity:Invoice", to: "service:InvoiceService", confidence: "high" },
        ],
      }),
    });

    const result = await topic(root, "orders");
   expect(result.entities).toEqual(["Order", "OrderItem"]);
   expect(result.flowSummary).toEqual({ nodes: 2, edges: 2 });
   expect(result.matchedIn).toContain("ontology");
    // v2.0.5: no call-graph.json in this fixture -> methods/dtos omitted.
    expect(result.methods).toBeUndefined();
    expect(result.dtos).toBeUndefined();
  });

  it("omits entities/flowSummary when the topic matches no module slug", async () => {
    await writeBaseFixture(root);
    await writeFiles(root, {
      ".ai/arch/entities.json": JSON.stringify({
        entities: [{ name: "Order", moduleSlug: "orders" }],
        relations: [],
      }),
      ".ai/arch/flow.json": JSON.stringify({
        nodes: [{ id: "entity:Order", layer: "entity", name: "Order", moduleSlug: "orders" }],
        edges: [],
      }),
    });

    const result = await topic(root, "nomatch");
    expect(result.entities).toBeUndefined();
    expect(result.flowSummary).toBeUndefined();
    expect(result.matchedIn).not.toContain("ontology");
  });

  it("omits entities without crashing when entities.json is missing", async () => {
    await writeBaseFixture(root);
    // flow.json present and would match "orders", but entities.json absent:
    // entities omitted, flowSummary still derived independently.
    await writeFiles(root, {
      ".ai/arch/flow.json": JSON.stringify({
        nodes: [{ id: "entity:Order", layer: "entity", name: "Order", moduleSlug: "orders" }],
        edges: [{ from: "entity:Order", to: "service:OrderService", confidence: "high" }],
      }),
    });

    const result = await topic(root, "orders");
   expect(result.entities).toBeUndefined();
   expect(result.flowSummary).toEqual({ nodes: 1, edges: 1 });
  });
  it("surfaces methods/dtos from call-graph.json for a matched module slug", async () => {
    await writeBaseFixture(root);
    await writeFiles(root, {
      ".ai/arch/call-graph.json": JSON.stringify({
        nodes: [
          { id: "method:OrderService#create", kind: "method", name: "create", moduleSlug: "orders" },
          { id: "method:OrderService#findById", kind: "method", name: "findById", moduleSlug: "orders" },
          // Frontend component shares kind "method" but a "component:" id -> excluded.
          { id: "component:OrderList", kind: "method", name: "OrderList", moduleSlug: "orders" },
          { id: "dto:OrderDTO", kind: "dto", name: "OrderDTO", moduleSlug: "orders" },
          { id: "dto:InvoiceDTO", kind: "dto", name: "InvoiceDTO", moduleSlug: "billing" },
          { id: "method:InvoiceService#total", kind: "method", name: "total", moduleSlug: "billing" },
        ],
        edges: [],
      }),
    });
    const result = await topic(root, "orders");
    // 2 real method nodes; the component:OrderList node is excluded by id prefix.
    expect(result.methods).toBe(2);
    expect(result.dtos).toBe(1);
    expect(result.matchedIn).toContain("ontology");
  });
});
