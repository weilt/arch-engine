import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanPythonSources } from "../../src/scanners/python-scanner.js";

const FIXTURE_APP = `from fastapi import FastAPI
from sqlalchemy import Column, Integer, String

app = FastAPI()

class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True)
    name = Column(String)

class OrderService:
    async def create_order(self, order):
        self.validate(order)
        self.repo.save(order)
        return order

    def validate(self, order):
        return True

@app.post("/orders")
async def create_order_endpoint(order: dict):
    return await service.create_order(order)

@app.get("/orders/{order_id}")
async def get_order(order_id: int):
    return {}
`;

const FIXTURE_MODELS = `from pydantic import BaseModel

class OrderCreate(BaseModel):
    name: str
    quantity: int
`;

describe("python-scanner", () => {
  it("discovers module, HTTP APIs, entities, methods and call edges", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "py-scan-"));
    try {
      await fs.writeFile(
        path.join(dir, "pyproject.toml"),
        '[project]\nname = "order-service"\nversion = "0.1.0"\n',
        "utf-8"
      );
      await fs.writeFile(path.join(dir, "app.py"), FIXTURE_APP, "utf-8");
      await fs.writeFile(path.join(dir, "models.py"), FIXTURE_MODELS, "utf-8");

      const result = await scanPythonSources(dir, "orderservice");

      // 1. Module discovered from pyproject.toml
      expect(result.modules).toHaveLength(1);
      expect(result.modules[0]!.name).toBe("order-service");
      expect(result.modules[0]!.slug).toBe("orderservice");
      expect(result.modules[0]!.repoSlug).toBe("orderservice");

      // 2. HTTP API endpoints (FastAPI)
      const fastapiApis = result.apis.filter((a) => a.framework === "fastapi");
      expect(fastapiApis).toHaveLength(2);
      const postApi = fastapiApis.find((a) => a.method === "POST");
      expect(postApi).toBeDefined();
      expect(postApi!.path).toBe("/orders");
      expect(postApi!.handlerFunc).toBe("create_order_endpoint");
      const getApi = fastapiApis.find((a) => a.method === "GET");
      expect(getApi).toBeDefined();
      expect(getApi!.path).toBe("/orders/{order_id}");

      // 3. Entity classes
      const order = result.classes.find((c) => c.name === "Order");
      expect(order).toBeDefined();
      expect(order!.ormType).toBe("sqlalchemy");
      expect(order!.tableName).toBe("orders");
      expect(order!.baseClass).toBe("Base");

      const orderCreate = result.classes.find((c) => c.name === "OrderCreate");
      expect(orderCreate).toBeDefined();
      expect(orderCreate!.ormType).toBe("pydantic");
      const fieldNames = orderCreate!.fields.map((f) => f.name);
      expect(fieldNames).toContain("name");
      expect(fieldNames).toContain("quantity");

      // 4. Method nodes
      const createOrder = result.methods.find((m) => m.name === "create_order");
      expect(createOrder).toBeDefined();
      expect(createOrder!.className).toBe("OrderService");
      expect(createOrder!.signature).toContain("create_order");

      const validate = result.methods.find((m) => m.name === "validate");
      expect(validate).toBeDefined();
      expect(validate!.className).toBe("OrderService");

      const endpoint = result.methods.find(
        (m) => m.name === "create_order_endpoint"
      );
      expect(endpoint).toBeDefined();
      expect(endpoint!.className).toBeUndefined();

      const getOrder = result.methods.find((m) => m.name === "get_order");
      expect(getOrder).toBeDefined();
      expect(getOrder!.className).toBeUndefined();

      // 5. Call edges
      const coEdges = result.callEdges.filter(
        (e) => e.source === createOrder!.id
      );
      const targets = coEdges.map((e) => e.target);
      expect(targets).toContain("OrderService.validate");
      expect(targets).toContain("repo.save");
      expect(coEdges.every((e) => e.kind === "calls")).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to directory basename when pyproject.toml is missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "py-nomod-"));
    try {
      await fs.writeFile(path.join(dir, "main.py"), "print('hi')\n", "utf-8");
      const result = await scanPythonSources(dir, "myrepo");
      expect(result.modules).toHaveLength(1);
      expect(result.modules[0]!.name).toBe(path.basename(dir));
      expect(result.modules[0]!.slug).toBe("myrepo");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("produces gRPC endpoints from proto files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "py-grpc-"));
    try {
      await fs.writeFile(
        path.join(dir, "pyproject.toml"),
        '[project]\nname = "grpc-svc"\n',
        "utf-8"
      );
      await fs.writeFile(
        path.join(dir, "svc.proto"),
        'syntax = "proto3";\nservice UserService {\n  rpc GetUser(GetReq) returns (GetResp);\n}\n',
        "utf-8"
      );
      const result = await scanPythonSources(dir, "grpcsvc");
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "py-empty-"));
    try {
      const result = await scanPythonSources(dir, "emptyrepo");
      expect(result.modules).toHaveLength(1);
      expect(result.apis).toEqual([]);
      expect(result.classes).toEqual([]);
      expect(result.methods).toEqual([]);
      expect(result.callEdges).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("extracts Django URL patterns", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "py-django-"));
    try {
      await fs.writeFile(
        path.join(dir, "pyproject.toml"),
        '[project]\nname = "django-svc"\n',
        "utf-8"
      );
      await fs.writeFile(
        path.join(dir, "urls.py"),
        `from django.urls import path
from . import views

urlpatterns = [
    path("users/", views.user_list),
    path("users/<int:pk>/", views.user_detail),
]
`,
        "utf-8"
      );
      const result = await scanPythonSources(dir, "djangosvc");
      const djangoApis = result.apis.filter((a) => a.framework === "django");
      expect(djangoApis).toHaveLength(2);
      expect(
        djangoApis.find(
          (a) => a.path === "users/" && a.handlerFunc === "views.user_list"
        )
      ).toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
