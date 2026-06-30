import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanCallGraphJava } from "../../src/scanners/call-graph-java.js";
import type { DocumentModel, JavaModule } from "../../src/types.js";

// Fixtures live alongside this test under tests/fixtures/call-graph-java/.
const FIXTURE_ROOT = path.join(__dirname, "..", "fixtures", "call-graph-java");

const MODULES: JavaModule[] = [
  { slug: "order", name: "order", path: "" },
];

const MODEL: DocumentModel = {
  modules: MODULES,
  apis: [],
  rpcs: [],
  packages: [],
};

describe("scanCallGraphJava", () => {
  it("emits method nodes for service methods", async () => {
    const graph = await scanCallGraphJava(FIXTURE_ROOT, MODULES, MODEL);

    const findById = graph.nodes.find(
      (n) => n.id === "method:OrderService#findById"
    );
    expect(findById).toBeDefined();
    expect(findById?.kind).toBe("method");
    expect(findById?.layer).toBe("service");
    expect(findById?.moduleSlug).toBe("order");

    const validate = graph.nodes.find(
      (n) => n.id === "method:OrderService#validate"
    );
    expect(validate).toBeDefined();
  });

  it("creates a same-class calls edge for this.validate()", async () => {
    const graph = await scanCallGraphJava(FIXTURE_ROOT, MODULES, MODEL);

    const edge = graph.edges.find(
      (e) =>
        e.from === "method:OrderService#findById" &&
        e.to === "method:OrderService#validate"
    );
    expect(edge).toBeDefined();
    expect(edge?.kind).toBe("calls");
    expect(edge?.confidence).toBe("low");
  });

  it("creates a cross-class calls edge for userClient.getUser() via field", async () => {
    const graph = await scanCallGraphJava(FIXTURE_ROOT, MODULES, MODEL);

    const edge = graph.edges.find(
      (e) =>
        e.from === "method:OrderService#findById" &&
        e.to === "method:UserClient#getUser"
    );
    expect(edge).toBeDefined();
    expect(edge?.kind).toBe("calls");
    expect(edge?.confidence).toBe("high");
  });

  it("attaches @Transactional to the annotated method only", async () => {
    const graph = await scanCallGraphJava(FIXTURE_ROOT, MODULES, MODEL);

    const findById = graph.nodes.find(
      (n) => n.id === "method:OrderService#findById"
    );
    expect(findById?.annotations).toContain("@Transactional");

    const validate = graph.nodes.find(
      (n) => n.id === "method:OrderService#validate"
    );
    expect(validate?.annotations).not.toContain("@Transactional");
  });

  it("emits a dto node with fields for OrderDTO", async () => {
    const graph = await scanCallGraphJava(FIXTURE_ROOT, MODULES, MODEL);

    const dto = graph.nodes.find((n) => n.id === "dto:OrderDTO");
    expect(dto).toBeDefined();
    expect(dto?.kind).toBe("dto");
    const fieldNames = dto?.fields?.map((f) => f.name).sort();
    expect(fieldNames).toEqual(["id", "orderName", "status"]);
    expect(dto?.fields?.find((f) => f.name === "id")?.type).toBe("Long");
  });

  it("creates a uses edge from the controller method to dto:OrderDTO", async () => {
    const graph = await scanCallGraphJava(FIXTURE_ROOT, MODULES, MODEL);

    const edge = graph.edges.find(
      (e) =>
        e.from === "method:OrderController#create" && e.to === "dto:OrderDTO"
    );
    expect(edge).toBeDefined();
    expect(edge?.kind).toBe("uses");
    expect(edge?.confidence).toBe("high");
  });
});
