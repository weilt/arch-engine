import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { getArchDir } from "../src/paths.js";
import { runStartInit } from "../src/pipeline.js";
import type { ArchIndex } from "../src/types.js";

// runStartInit resolves API keys (env) before the workspace branch, but the
// workspace scan path makes no embedding/summarize network calls, so no fetch
// mock is needed -- only the key env var.

const POM_XML = `<?xml version="1.0" encoding="UTF-8"?><project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>order-svc</artifactId><version>1.0.0-SNAPSHOT</version></project>`;

// A Spring controller with a class + method mapping so scanJavaSources emits
// one HTTP endpoint (GET /api/orders).
const JAVA_CONTROLLER = `package com.example;@RestController@RequestMapping("/api")public class OrderController {@GetMapping("/orders")public String list() { return "ok"; }}`;

const GO_MOD = "module github.com/example/billing-go\n";
const GO_SOURCE = [
  "package main",
  "",
  "type BillingOrder struct {",
  "  Id    int",
  "  Total int",
  "}",
  "",
  'func registerRoutes(r *gin.Engine) {',
  '  r.GET("/billing/orders", listBillingOrders)',
  "}",
  "",
  "func listBillingOrders() {}",
].join("\n");

const PY_PROJECT = '[project]\nname = "inventory-py"\n';
const PY_SOURCE = [
  "from fastapi import FastAPI",
  "from pydantic import BaseModel",
  "",
  "app = FastAPI()",
  "",
  "class Item(BaseModel):",
  "    name: str",
  "    qty: int",
  "",
  '@app.get("/items")',
  "def list_items():",
  "    return []",
].join("\n");

async function writeConfig(tmpRoot: string): Promise<void> {
  const config = {
    ...DEFAULT_CONFIG,
    scanners: { java: true, frontend: false },
  };
  await fs.mkdir(path.join(tmpRoot, ".ai", "arch"), { recursive: true });
  await fs.writeFile(
    path.join(tmpRoot, ".ai", "arch", "arch.config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}

async function writeWorkspaceManifest(tmpRoot: string): Promise<void> {
  await fs.writeFile(
    path.join(tmpRoot, "apt-workspace.json"),
    JSON.stringify({
      repos: [
        { path: "repo-java", lang: "java" },
        { path: "repo-go", lang: "go" },
        { path: "repo-python", lang: "python" },
      ],
    }),
    "utf-8"
  );
}

async function writeJavaRepo(tmpRoot: string): Promise<void> {
  const javaDir = path.join(tmpRoot, "repo-java", "order-svc", "src/main/java/com/example");
  await fs.mkdir(javaDir, { recursive: true });
  await fs.writeFile(path.join(tmpRoot, "repo-java", "order-svc", "pom.xml"), POM_XML);
  await fs.writeFile(path.join(javaDir, "OrderController.java"), JAVA_CONTROLLER);
}

async function writeGoRepo(tmpRoot: string): Promise<void> {
  const goDir = path.join(tmpRoot, "repo-go");
  await fs.mkdir(goDir, { recursive: true });
  await fs.writeFile(path.join(goDir, "go.mod"), GO_MOD);
  await fs.writeFile(path.join(goDir, "main.go"), GO_SOURCE);
}

async function writePythonRepo(tmpRoot: string): Promise<void> {
  const pyDir = path.join(tmpRoot, "repo-python");
  await fs.mkdir(pyDir, { recursive: true });
  await fs.writeFile(path.join(pyDir, "pyproject.toml"), PY_PROJECT);
  await fs.writeFile(path.join(pyDir, "app.py"), PY_SOURCE);
}

describe("runStartInit workspace mode", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arch-ws-"));
    process.env.OPENAI_API_KEY = "test";

    await writeConfig(tmpRoot);
    await writeWorkspaceManifest(tmpRoot);
    await writeJavaRepo(tmpRoot);
    await writeGoRepo(tmpRoot);
    await writePythonRepo(tmpRoot);
  });

  afterEach(async () => {
    delete process.env.OPENAI_API_KEY;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("scans java/go/python repos and merges modules + apis", async () => {
    const report = await runStartInit(tmpRoot);

    expect(report.status).toBe("ok");
    if (report.status !== "ok") return;

    // One module per repo: Java "order-svc", Go "repo-go", Python "repo-python".
    expect(report.moduleCount).toBeGreaterThanOrEqual(3);
    // One HTTP endpoint per repo.
    expect(report.apiCount).toBeGreaterThanOrEqual(3);

    const archDir = getArchDir(tmpRoot);

    // Each repo's module node is present in the unified arch index.
    const index = JSON.parse(
      await fs.readFile(path.join(archDir, "arch-index.json"), "utf-8")
    ) as ArchIndex;
    const moduleNodePaths = Object.keys(index.nodes).filter(
      (p) => index.nodes[p]!.kind === "module"
    );
    expect(moduleNodePaths).toContain("backend/order-svc");
    expect(moduleNodePaths).toContain("backend/repo-go");
    expect(moduleNodePaths).toContain("backend/repo-python");

    // Entities from the Go struct and the Python pydantic model are merged.
    const entities = JSON.parse(
      await fs.readFile(path.join(archDir, "entities.json"), "utf-8")
    ) as { entities: { name: string }[] };
    const entityNames = entities.entities.map((e) => e.name);
    expect(entityNames).toContain("BillingOrder");
    expect(entityNames).toContain("Item");
  });

  it("writes per-module api.md with each repo's route", async () => {
    const report = await runStartInit(tmpRoot);
    expect(report.status).toBe("ok");

    const archDir = getArchDir(tmpRoot);
    const javaApi = await fs.readFile(path.join(archDir, "backend", "order-svc", "api.md"), "utf-8");
    const goApi = await fs.readFile(path.join(archDir, "backend", "repo-go", "api.md"), "utf-8");
    const pyApi = await fs.readFile(path.join(archDir, "backend", "repo-python", "api.md"), "utf-8");

    expect(javaApi).toContain("/api/orders");
    expect(goApi).toContain("/billing/orders");
    expect(pyApi).toContain("/items");
  });

  it("isolates repo failures: a missing repo is skipped, others still scan", async () => {
    // Remove the Go repo entirely after fixture setup.
    await fs.rm(path.join(tmpRoot, "repo-go"), { recursive: true, force: true });

    const report = await runStartInit(tmpRoot);

    expect(report.status).toBe("ok");
    if (report.status !== "ok") return;
    // Java + Python modules survive even though Go was skipped.
    expect(report.moduleCount).toBeGreaterThanOrEqual(2);

    const index = JSON.parse(
      await fs.readFile(path.join(getArchDir(tmpRoot), "arch-index.json"), "utf-8")
    ) as ArchIndex;
    expect(Object.keys(index.nodes)).toContain("backend/order-svc");
    expect(Object.keys(index.nodes)).toContain("backend/repo-python");
    expect(Object.keys(index.nodes)).not.toContain("backend/repo-go");
  });
});
