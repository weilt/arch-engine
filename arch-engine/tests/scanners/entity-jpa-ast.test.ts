import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanJpaEntities } from "../../src/scanners/entity-jpa.js";
import { scanJpaEntitiesAst } from "../../src/scanners/entity-jpa-ast.js";
import { scanJpaEntitiesRegex } from "../../src/scanners/entity-jpa-regex.js";
import type { JavaModule } from "../../src/types.js";

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jpa-ast-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const ORDER_MODULE: JavaModule[] = [
  { slug: "order", name: "order", path: "order-module" },
];

const ENTITY_DIR = "order-module/src/main/java/com/example";

async function writeEntity(
  dir: string,
  file: string,
  source: string
): Promise<void> {
  const moduleDir = path.join(dir, ENTITY_DIR);
  await fs.mkdir(moduleDir, { recursive: true });
  await fs.writeFile(path.join(moduleDir, file), source);
}

// A simple @Entity with @Table, @Id and two @Column fields.
const SIMPLE_ENTITY = `package com.example;
import javax.persistence.*;
@Entity
@Table(name = "t_user")
public class UserDO {
  @Id
  @Column(name = "id", nullable = false)
  private Long id;
  @Column(name = "user_name")
  private String name;
}
`;

// @OneToMany(mappedBy = "order") on a List<OrderItemDO> field.
const RELATION_ENTITY = `package com.example;
import javax.persistence.*;
import java.util.List;
@Entity
public class OrderDO {
  @Id
  private Long id;
  @OneToMany(mappedBy = "order")
  private List<OrderItemDO> items;
}
`;

// @Entity exercising generic collection fields for every relation kind, plus
// a nested-generic Map that the regex collapses via simpleTypeName.
const GENERIC_ENTITY = `package com.example;
import javax.persistence.*;
import java.util.List;
import java.util.Set;
@Entity
public class CartDO {
  @ManyToOne
  private UserDO owner;
  @OneToMany(mappedBy = "cart")
  private List<LineItemDO> lines;
  @ManyToMany
  private Set<TagDO> tags;
}
`;

// Modern Java the AST still parses (records + switch expressions). The entity
// body is intentionally simple so the assertion targets "no crash".
const COMPLEX_ENTITY = `package com.example;
import javax.persistence.*;
@Entity
public class CatalogDO {
  @Id
  @Column(name = "id", nullable = false)
  private Long id;
  int score(int n) {
    return switch (n) { case 1 -> 10; default -> 20; };
  }
}
`;

// Has @Entity and a valid column field, but a stray trailing annotation token
// breaks the CST. java-parser throws on this file, so it must fall back to the
// regex extractor while yielding the same result.
const UNPARSEABLE_ENTITY = `package com.example;
@Entity
public class BrokenDO {
  @Column(name = "x")
  private Long y;
  @
}
`;

describe("scanJpaEntitiesAst (AST path)", () => {
  it("extracts an @Entity class with @Table and @Column fields", async () => {
    await withTmp(async (dir) => {
      await writeEntity(dir, "UserDO.java", SIMPLE_ENTITY);

      const { entities, relations } = await scanJpaEntitiesAst(dir, ORDER_MODULE);

      expect(entities).toHaveLength(1);
      const entity = entities[0]!;
      expect(entity.name).toBe("UserDO");
      expect(entity.table).toBe("t_user");
      expect(entity.moduleSlug).toBe("order");
      expect(entity.source).toBe("jpa");

      const id = entity.fields.find((f) => f.name === "id");
      expect(id?.type).toBe("Long");
      expect(id?.column).toBe("id");
      expect(id?.nullable).toBe(false);

      const name = entity.fields.find((f) => f.name === "name");
      expect(name?.type).toBe("String");
      expect(name?.column).toBe("user_name");
      expect(name?.nullable).toBe(true);

      expect(relations).toHaveLength(0);
    });
  });

  it("extracts @OneToMany(mappedBy = ...) relations", async () => {
    await withTmp(async (dir) => {
      await writeEntity(dir, "OrderDO.java", RELATION_ENTITY);

      const { entities, relations } = await scanJpaEntitiesAst(dir, ORDER_MODULE);

      expect(entities).toHaveLength(1);
      const entity = entities[0]!;
      expect(entity.name).toBe("OrderDO");
      // @OneToMany field is a relation, never emitted as a column.
      expect(entity.fields).toHaveLength(0);

      const o2m = relations.find((r) => r.kind === "one-to-many");
      expect(o2m).toBeDefined();
      expect(o2m?.from).toBe("OrderDO");
      expect(o2m?.to).toBe("OrderItemDO");
      // `field` is the property name (matches the regex scanner output).
      expect(o2m?.field).toBe("items");
      expect(o2m?.source).toBe("jpa");
    });
  });

  it("resolves generic collection field types to their element type", async () => {
    await withTmp(async (dir) => {
      await writeEntity(dir, "CartDO.java", GENERIC_ENTITY);

      const { relations } = await scanJpaEntitiesAst(dir, ORDER_MODULE);

      const tos = relations.map((r) => `${r.kind}:${r.to}`).sort();
      expect(tos).toEqual([
        "many-to-many:TagDO",
        "many-to-one:UserDO",
        "one-to-many:LineItemDO",
      ]);
    });
  });

  it("does not crash on modern/complex Java and still scans the entity", async () => {
    await withTmp(async (dir) => {
      await writeEntity(dir, "CatalogDO.java", COMPLEX_ENTITY);

      const { entities } = await scanJpaEntitiesAst(dir, ORDER_MODULE);

      expect(entities).toHaveLength(1);
      expect(entities[0]!.name).toBe("CatalogDO");
      const id = entities[0]!.fields.find((f) => f.name === "id");
      expect(id?.type).toBe("Long");
    });
  });

  it("falls back to regex for a single file that fails to parse", async () => {
    await withTmp(async (dir) => {
      await writeEntity(dir, "UserDO.java", SIMPLE_ENTITY);
      await writeEntity(dir, "BrokenDO.java", UNPARSEABLE_ENTITY);

      const { entities } = await scanJpaEntitiesAst(dir, ORDER_MODULE);

      // Both entities are present: UserDO via AST, BrokenDO via regex fallback.
      const names = entities.map((e) => e.name).sort();
      expect(names).toEqual(["BrokenDO", "UserDO"]);

      const broken = entities.find((e) => e.name === "BrokenDO");
      expect(broken?.fields).toHaveLength(1);
      const y = broken?.fields.find((f) => f.name === "y");
      expect(y?.type).toBe("Long");
      expect(y?.column).toBe("x");
    });
  });
});

describe("AST path matches regex path", () => {
  it("produces identical entity graphs for a clean @Entity file", async () => {
    await withTmp(async (dir) => {
      await writeEntity(dir, "UserDO.java", SIMPLE_ENTITY);

      const ast = await scanJpaEntitiesAst(dir, ORDER_MODULE);
      const regex = await scanJpaEntitiesRegex(dir, ORDER_MODULE);

      expect(ast).toEqual(regex);
    });
  });
});

// Sanity check that the public dispatcher exercises the AST path end-to-end.
describe("scanJpaEntities dispatcher", () => {
  it("routes through the AST path when java-parser is available", async () => {
    await withTmp(async (dir) => {
      await writeEntity(dir, "UserDO.java", SIMPLE_ENTITY);

      const viaDispatcher = await scanJpaEntities(dir, ORDER_MODULE);
      const viaAst = await scanJpaEntitiesAst(dir, ORDER_MODULE);

      expect(viaDispatcher).toEqual(viaAst);
    });
  });
});
