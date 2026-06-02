import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, runStartInit } from "@apt/arch-engine";
import {
  extractSection,
  handleQueryArch,
  handleSearchArch,
} from "../src/arch-query.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "../../arch-engine/tests/fixtures");

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);

    if (target.endsWith("/embeddings")) {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: body.input.map((text, index) => ({
            embedding: text.includes("login")
              ? [1, 0]
              : [0.1 * (index + 1), 0.2 * (index + 1)],
            index,
          })),
        }),
      };
    }

    if (target.endsWith("/chat/completions")) {
      const body = JSON.parse(String(init?.body)) as {
        messages: { content: string }[];
      };
      const userContent = body.messages.find((m) => m.content.includes("Context path"))
        ?.content;
      const pathMatch = userContent?.match(/Context path: ([^\n]+)/);
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

async function setupDemoProject(tmpRoot: string): Promise<void> {
  await fs.cp(path.join(fixturesRoot, "java-module"), tmpRoot, {
    recursive: true,
  });

  await fs.cp(
    path.join(fixturesRoot, "frontend", "pnpm-workspace.yaml"),
    path.join(tmpRoot, "pnpm-workspace.yaml")
  );
  await fs.cp(path.join(fixturesRoot, "frontend", "packages"), path.join(tmpRoot, "packages"), {
    recursive: true,
  });

  await fs.mkdir(path.join(tmpRoot, "docs"), { recursive: true });
  await fs.cp(
    path.join(fixturesRoot, "openapi", "petstore.json"),
    path.join(tmpRoot, "docs", "petstore.json")
  );

  await fs.mkdir(path.join(tmpRoot, ".ai", "arch"), { recursive: true });
  const config = {
    ...DEFAULT_CONFIG,
    apiSpecGlobs: ["docs/**/*.json"],
  };
  await fs.writeFile(
    path.join(tmpRoot, ".ai", "arch", "arch.config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}

describe("extractSection", () => {
  it("returns a single markdown section by heading", () => {
    const md = `# API

## POST /auth/login
Login endpoint.

## GET /auth/me
Current user.
`;
    const section = extractSection(md, "POST /auth/login");
    expect(section).toContain("## POST /auth/login");
    expect(section).toContain("Login endpoint.");
    expect(section).not.toContain("GET /auth/me");
  });

  it("matches arch index anchor ids to markdown headings", () => {
    const md = `# API

## POST /auth/login
Login endpoint.
`;
    const section = extractSection(md, "POST-/auth/login");
    expect(section).toContain("Login endpoint.");
  });

  it("throws when section not found", () => {
    expect(() => extractSection("# API\n\nNo sections.", "missing")).toThrow(
      /Section not found/
    );
  });
});

describe("arch-query handlers", () => {
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-arch-query-"));
    await setupDemoProject(tmpRoot);
    process.env.OPENAI_API_KEY = "test";
    vi.stubGlobal("fetch", mockFetch());

    const report = await runStartInit(tmpRoot);
    expect(report.status).toBe("ok");
  });

  afterAll(async () => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("handleQueryArch without path returns root children", async () => {
    const result = await handleQueryArch(tmpRoot);
    expect(result).toMatchObject({
      path: "root",
      kind: "root",
      title: "Architecture",
    });
    expect(Array.isArray((result as { children: unknown[] }).children)).toBe(true);
    expect((result as { children: { path: string }[] }).children.map((c) => c.path)).toEqual([
      "backend",
      "frontend",
    ]);
  });

  it("handleQueryArch returns node with mapped children", async () => {
    const result = await handleQueryArch(tmpRoot, "backend");
    expect(result).toMatchObject({
      path: "backend",
      kind: "module",
    });
    expect((result as { children: unknown[] }).children.length).toBeGreaterThan(0);
  });

  it("handleQueryArch with path#anchor extracts markdown section", async () => {
    const backend = await handleQueryArch(tmpRoot, "backend");
    const modulePath = (backend as { children: { path: string }[] }).children[0]?.path;
    expect(modulePath).toBeDefined();

    const apiPath = `${modulePath}/api`;
    const apiNode = await handleQueryArch(tmpRoot, apiPath);
    const anchors = (apiNode as { anchors?: string[] }).anchors ?? [];
    expect(anchors.length).toBeGreaterThan(0);

    const section = await handleQueryArch(tmpRoot, `${apiPath}#${anchors[0]}`);
    expect(typeof section).toBe("string");
    expect(section).toMatch(/^## /);
  });

  it("handleQueryArch throws for unknown path", async () => {
    await expect(handleQueryArch(tmpRoot, "backend/does-not-exist")).rejects.toThrow(
      /Path not found/
    );
  });

  it("handleSearchArch returns ranked hits", async () => {
    const hits = await handleSearchArch(tmpRoot, "login", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits[0]).toMatchObject({
      path: expect.any(String),
      kind: expect.any(String),
      summary: expect.any(String),
      score: expect.any(Number),
    });
  });

  it("handleSearchArch respects kind filter", async () => {
    const hits = await handleSearchArch(tmpRoot, "login", 10, { kind: "api" });
    expect(hits.every((h) => h.kind === "api")).toBe(true);
  });
});
