import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleQueryImpact, type ImpactResult } from "../src/impact-query.js";

// v2.0.5: call-graph.json extends query_impact with method callers/callees/
// annotations, DTO fields/usedBy, and component importers/templateUsers.
// Fixtures are written straight into <tmp>/.ai/arch/ (no mocks), mirroring
// impact-query.test.ts. flow.json/entities.json stay minimal so the existing
// entity/flow path does not short-circuit on "not built".

function flowJson(nodes: unknown[], edges: unknown[]): string {
  return JSON.stringify({ nodes, edges });
}

function entitiesJson(relations: unknown[]): string {
  return JSON.stringify({ entities: [], relations });
}

const CALL_GRAPH = {
  nodes: [
    {
      id: "method:OrderService#findById",
      kind: "method",
      name: "findById",
      annotations: ["@Transactional"],
    },
    { id: "method:OrderService#validate", kind: "method", name: "validate" },
    { id: "method:OrderController#create", kind: "method", name: "create" },
    {
      id: "dto:OrderDTO",
      kind: "dto",
      name: "OrderDTO",
      fields: [
        { name: "id", type: "Long" },
        { name: "status", type: "String" },
      ],
    },
    { id: "component:App", kind: "component", name: "App" },
    { id: "component:UserCard", kind: "component", name: "UserCard" },
  ],
  edges: [
    {
      from: "method:OrderService#findById",
      to: "method:OrderService#validate",
      kind: "calls",
      confidence: "high",
    },
    {
      from: "method:OrderController#create",
      to: "method:OrderService#findById",
      kind: "calls",
      confidence: "high",
    },
    {
      from: "method:OrderController#create",
      to: "dto:OrderDTO",
      kind: "uses",
      confidence: "high",
    },
    {
      from: "component:App",
      to: "component:UserCard",
      kind: "imports",
      confidence: "high",
    },
    {
      from: "component:App",
      to: "component:UserCard",
      kind: "template",
      confidence: "high",
    },
  ],
};

// Minimal entity/flow graph so the "Order" entity resolves in the no-callgraph
// tests; otherwise flow.json/entities.json can be empty arrays.
const ORDER_FLOW = flowJson(
  [
    { id: "entity:Order", layer: "entity", name: "Order" },
    {
      id: "service:OrderService",
      layer: "service",
      name: "OrderService",
      filePath: "svc/OrderService.java",
      moduleSlug: "base",
    },
  ],
  [{ from: "entity:Order", to: "service:OrderService", confidence: "high" }]
);
const ORDER_ENTITIES = entitiesJson([
  { from: "Order", to: "OrderItem", kind: "one-to-many", source: "jpa" },
]);

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

describe("handleQueryImpact call-graph (v2.0.5)", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "apt-impact-cg-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("matches a dotted method name to callers/callees/annotations", async () => {
    await writeFiles(root, {
      ".ai/arch/flow.json": flowJson([], []),
      ".ai/arch/entities.json": entitiesJson([]),
      ".ai/arch/call-graph.json": JSON.stringify(CALL_GRAPH),
    });

    const result = (await handleQueryImpact(
      root,
      "OrderService.findById"
    )) as ImpactResult;

    expect(result.method).toBeDefined();
    // create() calls findById() -> create is a caller.
    expect(result.method!.callers).toContain("method:OrderController#create");
    // findById() calls validate() -> validate is a callee.
    expect(result.method!.callees).toContain("method:OrderService#validate");
    expect(result.method!.annotations).toContain("@Transactional");
  });

  it("matches a DTO to its fields and the methods that use it", async () => {
    await writeFiles(root, {
      ".ai/arch/flow.json": flowJson([], []),
      ".ai/arch/entities.json": entitiesJson([]),
      ".ai/arch/call-graph.json": JSON.stringify(CALL_GRAPH),
    });

    const result = (await handleQueryImpact(
      root,
      "OrderDTO"
    )) as ImpactResult;

    expect(result.dto).toBeDefined();
    expect(result.dto!.fields).toHaveLength(2);
    expect(result.dto!.fields.map((f) => f.name)).toEqual(["id", "status"]);
    // create() uses OrderDTO -> it is a consumer of the DTO.
    expect(result.dto!.usedBy).toContain("method:OrderController#create");
  });

  it("matches a frontend component to importers and template users", async () => {
    await writeFiles(root, {
      ".ai/arch/flow.json": flowJson([], []),
      ".ai/arch/entities.json": entitiesJson([]),
      ".ai/arch/call-graph.json": JSON.stringify(CALL_GRAPH),
    });

    const result = (await handleQueryImpact(
      root,
      "UserCard"
    )) as ImpactResult;

    expect(result.component).toBeDefined();
    // App imports UserCard and uses UserCard as a template tag.
    expect(result.component!.importers).toContain("component:App");
    expect(result.component!.templateUsers).toContain("component:App");
  });

  it("omits call-graph fields when call-graph.json is missing", async () => {
    // A real flow entity so layers/relations still come back.
    await writeFiles(root, {
      ".ai/arch/flow.json": ORDER_FLOW,
      ".ai/arch/entities.json": ORDER_ENTITIES,
      // call-graph.json intentionally absent
    });

    const result = (await handleQueryImpact(root, "Order")) as ImpactResult;

    // Existing entity/flow path intact.
    expect(result.note).toBeUndefined();
    expect(result.layers.length).toBeGreaterThan(0);
    expect(result.layers.map((l) => l.layer)).toContain("service");
    expect(result.relations.map((r) => `${r.from}->${r.to}`)).toEqual([
      "Order->OrderItem",
    ]);
    // New v2.0.5 fields all omitted.
    expect(result.dto).toBeUndefined();
    expect(result.method).toBeUndefined();
    expect(result.component).toBeUndefined();
    expect(result.graphReferences).toBeUndefined();
  });

  it("omits call-graph fields silently when call-graph.json is corrupt", async () => {
    await writeFiles(root, {
      ".ai/arch/flow.json": ORDER_FLOW,
      ".ai/arch/entities.json": ORDER_ENTITIES,
      ".ai/arch/call-graph.json": "{ not valid json }}}",
    });

    const result = (await handleQueryImpact(root, "Order")) as ImpactResult;

    // Entity/flow results unaffected by a corrupt call-graph.
    expect(result.layers.length).toBeGreaterThan(0);
    expect(result.dto).toBeUndefined();
    expect(result.method).toBeUndefined();
    expect(result.component).toBeUndefined();
    expect(result.graphReferences).toBeUndefined();
  });
});
