import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanJpaEntities } from "../../src/scanners/entity-jpa.js";
import { scanMybatisEntities } from "../../src/scanners/entity-mybatis.js";
import { scanSqlEntities } from "../../src/scanners/entity-sql.js";
import { mergeEntityGraphs } from "../../src/scanners/entity-merge.js";
import type { JavaModule } from "../../src/types.js";

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "entity-scan-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const JPA_SOURCE = "package com.example;\nimport javax.persistence.*;\n@Entity\n@Table(name = \"t_order\")\npublic class OrderDO {\n    @Id\n    @Column(name = \"id\", nullable = false)\n    private Long id;\n    @Column(name = \"order_no\", nullable = false)\n    private String orderNo;\n    @Column(name = \"amount\")\n    private BigDecimal amount;\n    @ManyToOne\n    @JoinColumn(name = \"user_id\")\n    private UserDO user;\n    @OneToMany(mappedBy = \"order\")\n    private List<OrderItemDO> items;\n}\n";

const MYBATIS_SOURCE = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<mapper namespace=\"com.example.OrderMapper\">\n  <resultMap id=\"BaseResultMap\" type=\"com.example.entity.OrderDO\">\n    <result column=\"id\" property=\"id\"/>\n    <result column=\"order_no\" property=\"orderNo\"/>\n    <association property=\"user\" javaType=\"com.example.entity.UserDO\"/>\n    <collection property=\"items\" ofType=\"com.example.entity.OrderItemDO\"/>\n  </resultMap>\n</mapper>\n";

const SQL_SOURCE = "CREATE TABLE t_order (\n  id BIGINT NOT NULL,\n  user_id BIGINT NOT NULL,\n  amount DECIMAL(10,2) NOT NULL,\n  status VARCHAR(32) DEFAULT '0',\n  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  PRIMARY KEY (id),\n  FOREIGN KEY (user_id) REFERENCES t_user(id)\n);\n";

const ORDER_MODULE: JavaModule[] = [
  { slug: "order", name: "order", path: "order-module" },
];

describe("scanJpaEntities", () => {
  it("extracts @Entity class, @Table, @Column fields and relationship fields", async () => {
    await withTmp(async (dir) => {
      const moduleDir = path.join(dir, "order-module", "src/main/java/com/example");
      await fs.mkdir(moduleDir, { recursive: true });
      await fs.writeFile(path.join(moduleDir, "OrderDO.java"), JPA_SOURCE);

      const { entities, relations } = await scanJpaEntities(dir, ORDER_MODULE);

      expect(entities).toHaveLength(1);
      const entity = entities[0]!;
      expect(entity.name).toBe("OrderDO");
      expect(entity.table).toBe("t_order");
      expect(entity.moduleSlug).toBe("order");
      expect(entity.source).toBe("jpa");
      expect(entity.filePath).toBe("order-module/src/main/java/com/example/OrderDO.java");

      const id = entity.fields.find((f) => f.name === "id");
      expect(id?.type).toBe("Long");
      expect(id?.column).toBe("id");
      expect(id?.nullable).toBe(false);

      const orderNo = entity.fields.find((f) => f.name === "orderNo");
      expect(orderNo?.type).toBe("String");
      expect(orderNo?.column).toBe("order_no");
      expect(orderNo?.nullable).toBe(false);

      const amount = entity.fields.find((f) => f.name === "amount");
      expect(amount?.nullable).toBe(true);

      const m2o = relations.find((r) => r.kind === "many-to-one");
      expect(m2o).toBeDefined();
      expect(m2o?.from).toBe("OrderDO");
      expect(m2o?.to).toBe("UserDO");
      expect(m2o?.field).toBe("user");
      expect(m2o?.source).toBe("jpa");

      const o2m = relations.find((r) => r.kind === "one-to-many");
      expect(o2m).toBeDefined();
      expect(o2m?.to).toBe("OrderItemDO");
      expect(o2m?.field).toBe("items");
    });
  });

  it("ignores a java file without @Entity", async () => {
    await withTmp(async (dir) => {
      const moduleDir = path.join(dir, "order-module", "src/main/java/com/example");
      await fs.mkdir(moduleDir, { recursive: true });
      await fs.writeFile(
        path.join(moduleDir, "PlainPojo.java"),
        "package com.example;\npublic class PlainPojo { private Long id; }\n"
      );
      const { entities } = await scanJpaEntities(dir, ORDER_MODULE);
      expect(entities).toHaveLength(0);
    });
  });
});

describe("scanMybatisEntities", () => {
  it("extracts resultMap fields plus association/collection relations", async () => {
    await withTmp(async (dir) => {
      const moduleDir = path.join(dir, "order-module", "src/main/resources");
      await fs.mkdir(moduleDir, { recursive: true });
      await fs.writeFile(path.join(moduleDir, "OrderMapper.xml"), MYBATIS_SOURCE);

      const { entities, relations } = await scanMybatisEntities(dir, ORDER_MODULE);

      expect(entities).toHaveLength(1);
      const entity = entities[0]!;
      expect(entity.name).toBe("OrderDO");
      expect(entity.table).toBe("OrderDO");
      expect(entity.source).toBe("mybatis");

      const id = entity.fields.find((f) => f.name === "id");
      expect(id?.type).toBe("unknown");
      expect(id?.column).toBe("id");
      const orderNo = entity.fields.find((f) => f.name === "orderNo");
      expect(orderNo?.column).toBe("order_no");

      const assoc = relations.find((r) => r.kind === "many-to-one");
      expect(assoc).toBeDefined();
      expect(assoc?.from).toBe("OrderDO");
      expect(assoc?.to).toBe("UserDO");
      expect(assoc?.field).toBe("user");
      expect(assoc?.source).toBe("mybatis");

      const coll = relations.find((r) => r.kind === "one-to-many");
      expect(coll?.to).toBe("OrderItemDO");
      expect(coll?.field).toBe("items");
    });
  });
});

describe("scanSqlEntities", () => {
  it("extracts CREATE TABLE columns and FOREIGN KEY references", async () => {
    await withTmp(async (dir) => {
      await fs.writeFile(path.join(dir, "schema.sql"), SQL_SOURCE);

      const { entities, relations } = await scanSqlEntities(dir);

      expect(entities).toHaveLength(1);
      const entity = entities[0]!;
      expect(entity.table).toBe("t_order");
      expect(entity.name).toBe("t_order");
      expect(entity.moduleSlug).toBe("");
      expect(entity.source).toBe("sql");

      const id = entity.fields.find((f) => f.name === "id");
      expect(id?.type).toBe("BIGINT");
      expect(id?.nullable).toBe(false);
      const amount = entity.fields.find((f) => f.name === "amount");
      expect(amount?.type).toBe("DECIMAL");
      expect(amount?.nullable).toBe(false);
      const status = entity.fields.find((f) => f.name === "status");
      expect(status?.type).toBe("VARCHAR");
      expect(status?.nullable).toBe(true);

      expect(entity.fields.find((f) => f.name.toLowerCase() === "primary")).toBeUndefined();

      const fk = relations.find((r) => r.kind === "fk-reference");
      expect(fk).toBeDefined();
      expect(fk?.from).toBe("t_order");
      expect(fk?.to).toBe("t_user");
      expect(fk?.field).toBe("user_id");
      expect(fk?.source).toBe("sql");
    });
  });
});

describe("mergeEntityGraphs", () => {
  it("dedups entities by moduleSlug:table and unions fields with JPA>MyBatis>SQL preference", () => {
    const jpa = {
      entities: [
        {
          name: "User",
          table: "users",
          moduleSlug: "",
          filePath: "User.java",
          fields: [
            { name: "id", type: "Long", column: "id", nullable: false },
            { name: "name", type: "String", column: "name", nullable: false },
          ],
          source: "jpa" as const,
        },
      ],
      relations: [
        { from: "User", to: "Dept", kind: "many-to-one" as const, field: "dept", source: "jpa" as const },
      ],
    };
    const mybatis = {
      entities: [
        {
          name: "User",
          table: "users",
          moduleSlug: "",
          filePath: "UserMapper.xml",
          fields: [
            { name: "name", type: "unknown", column: "name" },
            { name: "email", type: "unknown", column: "email" },
          ],
          source: "mybatis" as const,
        },
      ],
      relations: [
        { from: "User", to: "Dept", kind: "many-to-one" as const, field: "dept", source: "mybatis" as const },
      ],
    };
    const sql = {
      entities: [
        {
          name: "users",
          table: "users",
          moduleSlug: "",
          filePath: "schema.sql",
          fields: [
            { name: "id", type: "BIGINT", column: "id", nullable: false },
            { name: "created_at", type: "TIMESTAMP", column: "created_at", nullable: true },
          ],
          source: "sql" as const,
        },
      ],
      relations: [
        { from: "users", to: "dept", kind: "fk-reference" as const, field: "dept_id", source: "sql" as const },
      ],
    };

    const graph = mergeEntityGraphs(jpa, mybatis, sql);

    expect(graph.entities).toHaveLength(1);
    const entity = graph.entities[0]!;
    expect(entity.fields.map((f) => f.name).sort()).toEqual([
      "created_at",
      "email",
      "id",
      "name",
    ]);
    expect(entity.fields.find((f) => f.name === "id")?.type).toBe("Long");
    expect(entity.fields.find((f) => f.name === "name")?.type).toBe("String");
    expect(entity.filePath).toBe("User.java");
    expect(entity.source).toBe("jpa");

    expect(graph.relations).toHaveLength(3);
  });
});
