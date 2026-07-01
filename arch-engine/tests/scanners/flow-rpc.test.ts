import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deriveFlowGraph } from "../../src/scanners/flow-scanner.js";
import type { DocumentModel } from "../../src/types.js";

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flow-rpc-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeJavaFile(
  dir: string,
  modulePath: string,
  layerPackage: "service" | "controller",
  fileName: string,
  body: string
): Promise<void> {
  const targetDir = path.join(
    dir,
    modulePath,
    "src/main/java/com/example",
    layerPackage
  );
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, fileName), body);
}

function moduleModel(
  rpcs: DocumentModel["rpcs"],
  modules?: DocumentModel["modules"]
): DocumentModel {
  return {
    modules: modules ?? [{ slug: "order", name: "order", path: "order-module" }],
    apis: [],
    rpcs,
    packages: [],
  };
}

describe("deriveFlowGraph Feign RPC Step 4", () => {
  it("produces rpc node and caller->rpc edge for an @Autowired Feign client", async () => {
    await withTmp(async (dir) => {
      await writeJavaFile(
        dir,
        "order-module",
        "service",
        "UserService.java",
        "package com.example.service;\n" +
          "public class UserService {\n" +
          "  @Autowired private UserClient userClient;\n" +
          "  public User findById(Long id) { return userClient.get(id); }\n" +
          "}\n"
      );
      const model = moduleModel([
        {
          id: "rpc-user",
          name: "UserClient",
          summary: "user feign client",
          moduleSlug: "order",
          source: "java",
        },
      ]);

      const graph = await deriveFlowGraph(dir, ["User"], model);

      const rpcNode = graph.nodes.find((n) => n.id === "rpc:UserClient");
      expect(rpcNode).toBeDefined();
      expect(rpcNode?.layer).toBe("rpc");
      expect(rpcNode?.moduleSlug).toBe("order");

      const callerEdge = graph.edges.find(
        (e) => e.from === "service:UserService" && e.to === "rpc:UserClient"
      );
      expect(callerEdge).toBeDefined();
      expect(callerEdge?.confidence).toBe("high");
      expect(callerEdge?.label).toBe("rpc");
    });
  });

  it("creates rpc->target edge when a matching target service node exists", async () => {
    await withTmp(async (dir) => {
      await writeJavaFile(
        dir,
        "order-module",
        "service",
        "UserService.java",
        "package com.example.service;\n" +
          "public class UserService {\n" +
          "  @Autowired private UserClient userClient;\n" +
          "  public User findById(Long id) { return null; }\n" +
          "}\n"
      );
      const model = moduleModel([
        {
          id: "rpc-user",
          name: "UserClient",
          summary: "user feign client",
          moduleSlug: "order",
          source: "java",
        },
      ]);

      const graph = await deriveFlowGraph(dir, ["User"], model);

      const targetEdge = graph.edges.find(
        (e) => e.from === "rpc:UserClient" && e.to === "service:UserService"
      );
      expect(targetEdge).toBeDefined();
      expect(targetEdge?.label).toBe("rpc");
    });
  });

  it("leaves the rpc node dangling when no target service matches", async () => {
    await withTmp(async (dir) => {
      await writeJavaFile(
        dir,
        "order-module",
        "service",
        "OrderService.java",
        "package com.example.service;\n" +
          "public class OrderService {\n" +
          "  @Autowired private UserClient userClient;\n" +
          "  public Order findById(Long id) { return null; }\n" +
          "}\n"
      );
      const model = moduleModel([
        {
          id: "rpc-user",
          name: "UserClient",
          summary: "user feign client",
          moduleSlug: "order",
          source: "java",
        },
      ]);

      const graph = await deriveFlowGraph(dir, ["Order"], model);

      expect(
        graph.edges.some(
          (e) => e.from === "service:OrderService" && e.to === "rpc:UserClient"
        )
      ).toBe(true);
      expect(graph.edges.some((e) => e.from === "rpc:UserClient")).toBe(false);
    });
  });

  it("produces no rpc nodes or edges when there are no @Autowired Feign clients", async () => {
    await withTmp(async (dir) => {
      await writeJavaFile(
        dir,
        "order-module",
        "service",
        "OrderService.java",
        "package com.example.service;\n" +
          "public class OrderService {\n" +
          "  @Autowired private OrderRepository repo;\n" +
          "  public Order findById(Long id) { return repo.find(id); }\n" +
          "}\n"
      );
      const model = moduleModel([
        {
          id: "rpc-user",
          name: "UserClient",
          summary: "user feign client",
          moduleSlug: "order",
          source: "java",
        },
      ]);

      const graph = await deriveFlowGraph(dir, ["Order"], model);

      expect(graph.nodes.some((n) => n.layer === "rpc")).toBe(false);
      expect(graph.edges.some((e) => e.label === "rpc")).toBe(false);
    });
  });

  it("skips Step 4 entirely when model.rpcs is empty", async () => {
    await withTmp(async (dir) => {
      await writeJavaFile(
        dir,
        "order-module",
        "service",
        "UserService.java",
        "package com.example.service;\n" +
          "public class UserService {\n" +
          "  @Autowired private UserClient userClient;\n" +
          "  public User findById(Long id) { return null; }\n" +
          "}\n"
      );
      const model = moduleModel([]);

      const graph = await deriveFlowGraph(dir, ["User"], model);

      expect(graph.nodes.some((n) => n.layer === "rpc")).toBe(false);
      expect(graph.edges.some((e) => e.label === "rpc")).toBe(false);
      expect(graph.nodes.some((n) => n.id === "service:UserService")).toBe(true);
    });
  });

  it("still returns Steps 1-3 results if Step 4 cannot scan files", async () => {
    const frontendModel: DocumentModel = {
      modules: [],
      apis: [],
      rpcs: [
        {
          id: "rpc-user",
          name: "UserClient",
          summary: "user feign client",
          moduleSlug: "order",
          source: "java",
        },
      ],
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
              name: "UserApi",
              file: "src/api/user.ts",
              description: "",
              endpoints: [{ method: "GET", path: "/api/users" }],
            },
          ],
        },
      ],
    };

    const graph = await deriveFlowGraph(
      "/nonexistent/arch-engine-root",
      ["User"],
      frontendModel
    );

    expect(
      graph.edges.some(
        (e) => e.from === "entity:User" && e.to === "api-client:UserApi"
      )
    ).toBe(true);
    expect(graph.nodes.some((n) => n.id === "api-client:UserApi")).toBe(true);
    expect(graph.nodes.some((n) => n.layer === "rpc")).toBe(false);
  });
});
