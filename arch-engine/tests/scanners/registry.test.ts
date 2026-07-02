import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createScannerRegistry,
  type ScannerContext,
  type ScannerPlugin,
} from "../../src/scanners/registry.js";
import type { DocumentModel, JavaModule } from "../../src/types.js";

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "registry-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const ORDER_MODULE: JavaModule[] = [
  { slug: "order", name: "order", path: "order-module" },
];

// A minimal @Entity source so the JPA scanner discovers OrderDO.
const JPA_SOURCE = `package com.example;
import javax.persistence.*;
@Entity
@Table(name = "t_order")
public class OrderDO {
  @Id
  @Column(name = "id", nullable = false)
  private Long id;
  @Column(name = "order_no", nullable = false)
  private String orderNo;
}
`;

function emptyModel(): DocumentModel {
  return { modules: ORDER_MODULE, apis: [], rpcs: [], packages: [] };
}

describe("createScannerRegistry", () => {
  it("returns 8 plugins: 5 entity-phase + 1 flow-phase + 2 call-graph-phase", () => {
    const registry = createScannerRegistry();

    expect(registry).toHaveLength(8);

    const entityPlugins = registry.filter((p) => p.phase === "entity");
    const flowPlugins = registry.filter((p) => p.phase === "flow");
    const callGraphPlugins = registry.filter((p) => p.phase === "call-graph");
    expect(entityPlugins).toHaveLength(5);
    expect(flowPlugins).toHaveLength(1);
    expect(callGraphPlugins).toHaveLength(2);

    const names = registry.map((p) => p.name).sort();
    expect(names).toEqual([
      "call-graph-frontend",
      "call-graph-java",
      "entity-jpa",
      "entity-mybatis",
      "entity-sql",
      "flow-derive",
      "go-scanner",
      "python-scanner",
    ]);
  });

  it("entity-phase plugins produce entity results from a JPA @Entity fixture", async () => {
    await withTmp(async (dir) => {
      const javaDir = path.join(dir, "order-module", "src/main/java/com/example");
      await fs.mkdir(javaDir, { recursive: true });
      await fs.writeFile(path.join(javaDir, "OrderDO.java"), JPA_SOURCE);

      const ctx: ScannerContext = { projectRoot: dir, modules: ORDER_MODULE, model: emptyModel() };
      const registry = createScannerRegistry();

      // Collect results the same way the pipeline does (only entity-phase plugins).
      const collected: Record<string, number> = {};
      for (const plugin of registry) {
        if (plugin.phase !== "entity") continue;
        const result = await plugin.scan(ctx);
        if (result.entities?.entities) {
          collected[plugin.name] = result.entities.entities.length;
        }
      }

      expect(collected["entity-jpa"]).toBe(1);
      // JPA plugin is the one that should surface OrderDO.
      const jpa = registry.find((p) => p.name === "entity-jpa")!;
      const res = await jpa.scan(ctx);
      expect(res.entities?.entities[0]?.name).toBe("OrderDO");
      expect(res.entities?.entities[0]?.table).toBe("t_order");
    });
  });

  it("flow-phase plugin returns no flows when entityNames is empty", async () => {
    await withTmp(async (dir) => {
      const ctx: ScannerContext = {
        projectRoot: dir,
        modules: ORDER_MODULE,
        model: emptyModel(),
        // entityNames omitted => treated as empty by the flow-derive plugin
      };

      const registry = createScannerRegistry();
      const flow = registry.find((p) => p.phase === "flow")!;
      const result = await flow.scan(ctx);

      expect(result.flows).toBeUndefined();
    });
  });

  it("a plugin that throws does not crash registry consumption (error tolerance)", async () => {
    await withTmp(async (dir) => {
      const javaDir = path.join(dir, "order-module", "src/main/java/com/example");
      await fs.mkdir(javaDir, { recursive: true });
      await fs.writeFile(path.join(javaDir, "OrderDO.java"), JPA_SOURCE);

      const ctx: ScannerContext = { projectRoot: dir, modules: ORDER_MODULE, model: emptyModel() };

      // Mirror the pipeline's registry-driven loop with a plugin that throws
      // mixed in. The loop must swallow the failure and still capture the
      // healthy plugin's results.
      const throwingPlugin: ScannerPlugin = {
        name: "entity-broken",
        phase: "entity",
        async scan() {
          throw new Error("boom");
        },
      };
      const jpaPlugin = createScannerRegistry().find((p) => p.name === "entity-jpa")!;
      const registry: ScannerPlugin[] = [throwingPlugin, jpaPlugin];

      const entityResults: Record<string, unknown> = {};
      const errors: string[] = [];

      for (const plugin of registry) {
        if (plugin.phase !== "entity") continue;
        try {
          const result = await plugin.scan(ctx);
          if (result.entities?.entities) {
            entityResults[plugin.name] = result.entities.entities.length;
          }
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }

      // The throwing plugin's failure was contained...
      expect(errors).toEqual(["boom"]);
      // ...and the healthy plugin still ran and produced its entity.
      expect(entityResults["entity-jpa"]).toBe(1);
    });
  });
});
