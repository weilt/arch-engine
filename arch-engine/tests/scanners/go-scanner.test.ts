import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanGoSources } from "../../src/scanners/go-scanner.js";

const FIXTURE_GO = `package main

import "github.com/gin-gonic/gin"

type Order struct {
    ID    int    \`json:"id"\`
    Name  string \`json:"name"\`
}

type OrderService struct {
    repo *OrderRepo
}

func (s *OrderService) CreateOrder(order Order) error {
    s.validate(order)
    s.repo.Save(order)
    return nil
}

func (s *OrderService) validate(order Order) error {
    return nil
}

func main() {
    r := gin.Default()
    r.POST("/orders", s.CreateOrder)
    r.GET("/orders/:id", s.GetOrder)
}
`;

describe("go-scanner", () => {
  it("discovers module, HTTP APIs, structs, methods and call edges", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "go-scan-"));
    try {
      await fs.writeFile(
        path.join(dir, "go.mod"),
        "module github.com/test/orderservice\n\ngo 1.21\n",
        "utf-8"
      );
      await fs.writeFile(path.join(dir, "main.go"), FIXTURE_GO, "utf-8");

      const result = await scanGoSources(dir, "orderservice");

      // 1. Module discovered from go.mod
      expect(result.modules).toHaveLength(1);
      expect(result.modules[0]!.name).toBe("github.com/test/orderservice");
      expect(result.modules[0]!.slug).toBe("orderservice");
      expect(result.modules[0]!.repoSlug).toBe("orderservice");

      // 2. HTTP API endpoints (gin)
      const ginApis = result.apis.filter((a) => a.framework === "gin");
      expect(ginApis).toHaveLength(2);
      const postApi = ginApis.find((a) => a.method === "POST");
      expect(postApi).toBeDefined();
      expect(postApi!.path).toBe("/orders");
      expect(postApi!.handlerFunc).toBe("s.CreateOrder");
      const getApi = ginApis.find((a) => a.method === "GET");
      expect(getApi).toBeDefined();
      expect(getApi!.path).toBe("/orders/:id");

      // 3. Struct "Order" with 2 fields and json tags
      const order = result.structs.find((s) => s.name === "Order");
      expect(order).toBeDefined();
      expect(order!.fields).toHaveLength(2);
      expect(order!.fields[0]!.name).toBe("ID");
      expect(order!.fields[0]!.type).toBe("int");
      expect(order!.fields[0]!.tag).toBe("id");
      expect(order!.fields[1]!.name).toBe("Name");
      expect(order!.fields[1]!.type).toBe("string");
      expect(order!.fields[1]!.tag).toBe("name");

      // 4. Method nodes
      const createOrder = result.methods.find((m) => m.name === "CreateOrder");
      expect(createOrder).toBeDefined();
      expect(createOrder!.receiver).toBe("OrderService");
      expect(createOrder!.signature).toContain("CreateOrder");
      const validate = result.methods.find((m) => m.name === "validate");
      expect(validate).toBeDefined();
      expect(validate!.receiver).toBe("OrderService");
      // main is a standalone function with empty receiver
      const mainFn = result.methods.find((m) => m.name === "main");
      expect(mainFn).toBeDefined();
      expect(mainFn!.receiver).toBe("");

      // 5. Call edges
      const coEdges = result.callEdges.filter(
        (e) => e.source === createOrder!.id
      );
      const targets = coEdges.map((e) => e.target);
      expect(targets).toContain("s.validate");
      expect(targets).toContain("repo.Save");
      expect(coEdges.every((e) => e.kind === "calls")).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to directory basename when go.mod is missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "go-nomod-"));
    try {
      await fs.writeFile(path.join(dir, "main.go"), "package main\n", "utf-8");
      const result = await scanGoSources(dir, "myrepo");
      expect(result.modules).toHaveLength(1);
      expect(result.modules[0]!.name).toBe(path.basename(dir));
      expect(result.modules[0]!.slug).toBe("myrepo");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("produces gRPC endpoints from proto files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "go-grpc-"));
    try {
      await fs.writeFile(
        path.join(dir, "go.mod"),
        "module github.com/test/grpcsvc\n",
        "utf-8"
      );
      await fs.writeFile(
        path.join(dir, "svc.proto"),
        'syntax = "proto3";\nservice UserService {\n  rpc GetUser(GetReq) returns (GetResp);\n}\n',
        "utf-8"
      );
      const result = await scanGoSources(dir, "grpcsvc");
      const grpcApis = result.apis.filter((a) => a.framework === "grpc");
      expect(grpcApis).toHaveLength(1);
      expect(grpcApis[0]!.method).toBe("POST");
      expect(grpcApis[0]!.path).toBe("/UserService/GetUser");
      expect(grpcApis[0]!.handlerFunc).toBe("GetUser");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("handles empty repositories gracefully", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "go-empty-"));
    try {
      const result = await scanGoSources(dir, "emptyrepo");
      expect(result.modules).toHaveLength(1);
      expect(result.apis).toEqual([]);
      expect(result.structs).toEqual([]);
      expect(result.methods).toEqual([]);
      expect(result.callEdges).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("extracts chi and net/http routes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "go-chi-"));
    try {
      await fs.writeFile(
        path.join(dir, "go.mod"),
        "module github.com/test/chisvc\n",
        "utf-8"
      );
      await fs.writeFile(
        path.join(dir, "main.go"),
        `package main

import (
    "net/http"
    "github.com/go-chi/chi/v5"
)

func main() {
    r := chi.NewRouter()
    r.Get("/users/{id}", getUser)
    r.Post("/users", createUser)
    http.HandleFunc("/health", healthHandler)
}
`,
        "utf-8"
      );
      const result = await scanGoSources(dir, "chisvc");
      const chiApis = result.apis.filter((a) => a.framework === "chi");
      expect(chiApis).toHaveLength(2);
      expect(chiApis.find((a) => a.method === "GET" && a.path === "/users/{id}")).toBeDefined();
      expect(chiApis.find((a) => a.method === "POST" && a.path === "/users")).toBeDefined();

      const httpApis = result.apis.filter((a) => a.framework === "net-http");
      expect(httpApis).toHaveLength(1);
      expect(httpApis[0]!.method).toBe("GET");
      expect(httpApis[0]!.path).toBe("/health");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
