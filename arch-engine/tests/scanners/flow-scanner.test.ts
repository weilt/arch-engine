import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deriveFlowGraph } from "../../src/scanners/flow-scanner.js";
import type { DocumentModel } from "../../src/types.js";

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flow-scan-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const EMPTY_MODEL: DocumentModel = {
  modules: [],
  apis: [],
  rpcs: [],
  packages: [],
};

async function writeService(
  dir: string,
  modulePath: string,
  fileName: string,
  body: string
): Promise<void> {
  const serviceDir = path.join(
    dir,
    modulePath,
    "src/main/java/com/example/service"
  );
  await fs.mkdir(serviceDir, { recursive: true });
  await fs.writeFile(path.join(serviceDir, fileName), body);
}

describe("deriveFlowGraph", () => {
  it("derives a backend service edge with high confidence from a method signature", async () => {
    await withTmp(async (dir) => {
      await writeService(
        dir,
        "order-module",
        "OrderService.java",
        "package com.example.service;\npublic class OrderService {\n  public Order findById(Long id) { return null; }\n}\n"
      );
      const model: DocumentModel = {
        modules: [{ slug: "order", name: "order", path: "order-module" }],
        apis: [],
        rpcs: [],
        packages: [],
      };

      const graph = await deriveFlowGraph(dir, ["Order"], model);

      const node = graph.nodes.find((n) => n.id === "service:OrderService");
      expect(node).toBeDefined();
      expect(node?.layer).toBe("service");
      expect(node?.moduleSlug).toBe("order");

      const edge = graph.edges.find(
        (e) => e.from === "entity:Order" && e.to === "service:OrderService"
      );
      expect(edge).toBeDefined();
      expect(edge?.confidence).toBe("high");
    });
  });

  it("derives a frontend api-client edge when an entity name appears in an endpoint path", async () => {
    await withTmp(async (dir) => {
      const model: DocumentModel = {
        modules: [],
        apis: [],
        rpcs: [],
        packages: [
          {
            slug: "web",
            name: "web",
            description: "",
            components: [],
            utils: [],
            enums: [],
            apiClients: [
              {
                name: "OrderApi",
                file: "src/api/order.ts",
                description: "",
                endpoints: [{ method: "GET", path: "/api/orders" }],
              },
            ],
          },
        ],
      };

      const graph = await deriveFlowGraph(dir, ["Order"], model);

      const node = graph.nodes.find((n) => n.id === "api-client:OrderApi");
      expect(node).toBeDefined();
      expect(node?.layer).toBe("api-client");

      const edge = graph.edges.find(
        (e) => e.from === "entity:Order" && e.to === "api-client:OrderApi"
      );
      expect(edge).toBeDefined();
      expect(edge?.confidence).toBe("high");
    });
  });

  it("classifies confidence low when the entity name appears only in a comment", async () => {
    await withTmp(async (dir) => {
      await writeService(
        dir,
        "order-module",
        "FooService.java",
        "package com.example.service;\npublic class FooService {\n  // TODO revisit Order handling later\n  public String hello() { return \"x\"; }\n}\n"
      );
      const model: DocumentModel = {
        modules: [{ slug: "order", name: "order", path: "order-module" }],
        apis: [],
        rpcs: [],
        packages: [],
      };

      const graph = await deriveFlowGraph(dir, ["Order"], model);

      const edge = graph.edges.find(
        (e) => e.from === "entity:Order" && e.to === "service:FooService"
      );
      expect(edge).toBeDefined();
      expect(edge?.confidence).toBe("low");
    });
  });

  it("returns an empty graph without throwing when entityNames is empty", async () => {
    const graph = await deriveFlowGraph("/nonexistent/path", [], EMPTY_MODEL);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("batch-scans each layer file once across multiple entities", async () => {
    await withTmp(async (dir) => {
      await writeService(
        dir,
        "m",
        "OrderService.java",
        "public class OrderService { public Order get(Long id) { return null; } }"
      );
      await writeService(
        dir,
        "m",
        "UserService.java",
        "public class UserService { public User get(Long id) { return null; } }"
      );
      await writeService(
        dir,
        "m",
        "MixedService.java",
        "public class MixedService { public Order findOrder(Long id) { return null; } public User findUser(Long id) { return null; } }"
      );
      const model: DocumentModel = {
        modules: [{ slug: "m", name: "m", path: "m" }],
        apis: [],
        rpcs: [],
        packages: [],
      };

      const graph = await deriveFlowGraph(dir, ["Order", "User"], model);

      const serviceNodeIds = graph.nodes
        .filter((n) => n.layer === "service")
        .map((n) => n.id)
        .sort();
      // Each of the 3 files is a single node (no entity x file duplication).
      expect(serviceNodeIds).toEqual([
        "service:MixedService",
        "service:OrderService",
        "service:UserService",
      ]);
      expect(new Set(serviceNodeIds).size).toBe(serviceNodeIds.length);

      const has = (from: string, to: string): boolean =>
        graph.edges.some((e) => e.from === from && e.to === to);
      expect(has("entity:Order", "service:OrderService")).toBe(true);
      expect(has("entity:User", "service:UserService")).toBe(true);
      // MixedService matched by both entities during one read of the file.
      expect(has("entity:Order", "service:MixedService")).toBe(true);
      expect(has("entity:User", "service:MixedService")).toBe(true);
      // UserService does not reference Order, and vice versa.
      expect(has("entity:Order", "service:UserService")).toBe(false);
      expect(has("entity:User", "service:OrderService")).toBe(false);
    });
  });
});
