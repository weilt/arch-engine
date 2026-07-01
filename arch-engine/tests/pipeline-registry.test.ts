import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { getArchDir } from "../src/paths.js";
import { runStartInit } from "../src/pipeline.js";

// Mocks the OpenAI-compatible embedding + chat endpoints so runStartInit can
// run end-to-end without real API keys. Mirrors pipeline.integration.test.ts.
function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);

    if (target.endsWith("/embeddings")) {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: body.input.map((_, index) => ({
            embedding: [0.1 * (index + 1), 0.2 * (index + 1)],
            index,
          })),
        }),
      };
    }

    if (target.endsWith("/chat/completions")) {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: string }[];
      };
      const userContent =
        body.messages.find((m) => m.role === "user")?.content ?? "";

      if (userContent.includes("Candidates (")) {
        const jsonMatch = userContent.match(/Candidates \(\d+\):\s*(\[[\s\S]+\])/);
        const candidates = jsonMatch
          ? (JSON.parse(jsonMatch[1]!) as { name: string; kind: string; signatures: string[] }[])
          : [];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    cards: candidates.map((c) => ({
                      kind: c.kind,
                      name: c.name,
                      summary: `${c.name} summary`,
                      whenToUse: "when needed",
                      howToUse: "see source",
                      exports: c.signatures,
                      related: [],
                      tags: [],
                    })),
                  }),
                },
              },
            ],
          }),
        };
      }

      const pathMatch = userContent.match(/Context path: ([^\n]+)/);
      const pathKey = pathMatch?.[1] ?? "unknown";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chunks: [
                    {
                      title: `${pathKey} overview`,
                      text: `Overview content for ${pathKey}`,
                      keywords: ["overview"],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      };
    }

    throw new Error(`Unexpected fetch URL: ${target}`);
  });
}

const POM_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<project xmlns="http://maven.apache.org/POM/4.0.0">',
  "  <modelVersion>4.0.0</modelVersion>",
  "  <groupId>com.example</groupId>",
  "  <artifactId>order-module</artifactId>",
  "  <version>1.0.0-SNAPSHOT</version>",
  "</project>",
].join("\n");

const JPA_ENTITY = [
  "package com.example;",
  "import javax.persistence.*;",
  "@Entity",
  '@Table(name = "t_order")',
  "public class OrderDO {",
  "  @Id",
  '  @Column(name = "id", nullable = false)',
  "  private Long id;",
  '  @Column(name = "order_no", nullable = false)',
  "  private String orderNo;",
  "}",
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

describe("runStartInit via Scanner Registry", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arch-registry-"));
    process.env.OPENAI_API_KEY = "test";
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(async () => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("succeeds with status ok and no entities when no Java modules are present", async () => {
    await writeConfig(tmpRoot);
    // No pom.xml anywhere => findMavenModules returns [] and the registry's
    // entity plugins find nothing, leaving model.entities undefined.

    const report = await runStartInit(tmpRoot);

    expect(report.status).toBe("ok");
    await expect(
      fs.readFile(path.join(getArchDir(tmpRoot), "entities.json"))
    ).rejects.toThrow();
  });

  it("produces model.entities through the registry path for a JPA fixture", async () => {
    await writeConfig(tmpRoot);

    const javaDir = path.join(tmpRoot, "order-module", "src/main/java/com/example");
    await fs.mkdir(javaDir, { recursive: true });
    await fs.writeFile(path.join(tmpRoot, "order-module", "pom.xml"), POM_XML);
    await fs.writeFile(path.join(javaDir, "OrderDO.java"), JPA_ENTITY);

    const report = await runStartInit(tmpRoot);

    expect(report.status).toBe("ok");

    const parsed = JSON.parse(
      await fs.readFile(path.join(getArchDir(tmpRoot), "entities.json"), "utf-8")
    ) as { entities: { name: string; table: string }[] };
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0]!.name).toBe("OrderDO");
    expect(parsed.entities[0]!.table).toBe("t_order");
  });
});
