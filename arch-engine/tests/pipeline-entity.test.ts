import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanJpaEntities } from "../src/scanners/entity-jpa.js";
import { scanMybatisEntities } from "../src/scanners/entity-mybatis.js";
import { scanSqlEntities } from "../src/scanners/entity-sql.js";
import { mergeEntityGraphs } from "../src/scanners/entity-merge.js";
import { deriveFlowGraph } from "../src/scanners/flow-scanner.js";
import { writeEntityDocs } from "../src/writer/entity-md.js";
import { writeFlowDocs } from "../src/writer/flow-md.js";
import { getArchDir } from "../src/paths.js";
import type { DocumentModel, EntityGraph, FlowGraph, JavaModule } from "../src/types.js";

// The scanner + writer chain exercises the same sequence runStartInit wires up
// for v2.0.3, without needing embedding/summarize APIs.

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-entity-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const ORDER_MODULE: JavaModule[] = [
  { slug: "order", name: "order", path: "order-module" },
];

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
  @ManyToOne
  @JoinColumn(name = "user_id")
  private UserDO user;
}
`;

const SERVICE_SOURCE = `package com.example.service;
public class OrderService {
  public OrderDO findById(Long id) { return null; }
}
`;

describe("pipeline entity/flow chain", () => {
  it("scans entities, derives flows, and writes entities.json/flow.json artifacts", async () => {
    await withTmp(async (dir) => {
      const javaDir = path.join(dir, "order-module", "src/main/java/com/example");
      const serviceDir = path.join(dir, "order-module", "src/main/java/com/example/service");
      await fs.mkdir(serviceDir, { recursive: true });
      await fs.writeFile(path.join(javaDir, "OrderDO.java"), JPA_SOURCE);
      await fs.writeFile(path.join(serviceDir, "OrderService.java"), SERVICE_SOURCE);

      // Mirror the pipeline ordering: JPA, then MyBatis, then SQL.
      const jpa = await scanJpaEntities(dir, ORDER_MODULE);
      const mybatis = await scanMybatisEntities(dir, ORDER_MODULE);
      const sql = await scanSqlEntities(dir);
      const merged = mergeEntityGraphs(jpa, mybatis, sql);

      expect(merged.entities).toHaveLength(1);
      const entityNames = merged.entities.map((e) => e.name);

      const model: DocumentModel = {
        modules: ORDER_MODULE,
        apis: [],
        rpcs: [],
        packages: [],
      };
      const flows = await deriveFlowGraph(dir, entityNames, model);

      await writeEntityDocs(dir, merged);
      await writeFlowDocs(dir, flows);

      const archDir = getArchDir(dir);
      const entityJson = JSON.parse(
        await fs.readFile(path.join(archDir, "entities.json"), "utf-8")
      ) as EntityGraph;
      const flowJson = JSON.parse(
        await fs.readFile(path.join(archDir, "flow.json"), "utf-8")
      ) as FlowGraph;

      expect(entityJson.entities[0]!.name).toBe("OrderDO");
      expect(entityJson.entities[0]!.table).toBe("t_order");
      expect(entityJson.relations.find((r) => r.kind === "many-to-one")?.to).toBe("UserDO");

      const serviceEdge = flowJson.edges.find(
        (e) => e.from === "entity:OrderDO" && e.to === "service:OrderService"
      );
      expect(serviceEdge).toBeDefined();
      expect(serviceEdge?.confidence).toBe("high");

      // Markdown companions exist alongside the JSON artifacts.
      await fs.access(path.join(archDir, "entities.md"));
      await fs.access(path.join(archDir, "flow.md"));
    });
  });

  it("degrades gracefully when no entities are discovered", async () => {
    await withTmp(async (dir) => {
      // Java-scanner-disabled semantics: an empty module set yields no
      // entities, mirroring how the pipeline leaves model.entities undefined.
      const jpa = await scanJpaEntities(dir, []);
      const mybatis = await scanMybatisEntities(dir, []);
      const sql = await scanSqlEntities(dir);
      const merged = mergeEntityGraphs(jpa, mybatis, sql);

      const model: DocumentModel = {
        modules: [],
        apis: [],
        rpcs: [],
        packages: [],
      };

      expect(merged.entities).toHaveLength(0);
      // deriveFlowGraph returns an empty graph without throwing.
      const flows = await deriveFlowGraph(dir, [], model);
      expect(flows.nodes).toEqual([]);
      expect(flows.edges).toEqual([]);

      // The pipeline guards writes on model.entities being set; when undefined
      // it skips writing, so no artifacts appear and nothing throws.
      expect(model.entities).toBeUndefined();
      expect(model.flows).toBeUndefined();

      const archDir = getArchDir(dir);
      await expect(fs.readFile(path.join(archDir, "entities.json"))).rejects.toThrow();
      await expect(fs.readFile(path.join(archDir, "flow.json"))).rejects.toThrow();
    });
  });

  it("writes entities.json atomically: valid JSON, no leftover .tmp files", async () => {
    await withTmp(async (dir) => {
      const graph: EntityGraph = {
        entities: [
          {
            name: "Widget",
            table: "widget",
            moduleSlug: "core",
            filePath: "core/Widget.java",
            fields: [{ name: "id", type: "Long", column: "id", nullable: false }],
            source: "jpa",
          },
        ],
        relations: [],
      };

      await writeEntityDocs(dir, graph);

      const archDir = getArchDir(dir);
      const entries = await fs.readdir(archDir);
      expect(entries.some((e) => e.endsWith(".tmp"))).toBe(false);

      const parsed = JSON.parse(
        await fs.readFile(path.join(archDir, "entities.json"), "utf-8")
      ) as EntityGraph;
      expect(parsed.entities).toHaveLength(1);
      expect(parsed.entities[0]!.name).toBe("Widget");
      expect(parsed.entities[0]!.fields[0]!.type).toBe("Long");
    });
  });
});
