import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import {
  buildAllChunks,
  callSemanticSplit,
  chunkStructuredEntities,
  estimateTokens,
  localSingleChunk,
  shouldUseLocalSplit,
  splitOversizedChunks,
} from "../../src/chunking/semantic.js";
import type { DocumentModel } from "../../src/types.js";

const fixtureModel: DocumentModel = {
  modules: [{ slug: "auth", name: "auth", path: "services/auth" }],
  apis: [
    {
      id: "POST-/auth/login",
      method: "POST",
      path: "/auth/login",
      summary: "User login",
      tags: ["auth", "frontend-facing"],
      audience: "frontend-facing",
      source: "openapi",
      moduleSlug: "auth",
    },
  ],
  rpcs: [
    {
      id: "UserClient#getUser",
      name: "UserClient#getUser",
      summary: "Fetch user by id",
      moduleSlug: "auth",
      source: "java",
    },
  ],
  packages: [
    {
      slug: "ui",
      name: "@app/ui",
      description: "Shared UI",
      components: [
        {
          name: "Button",
          file: "src/components/Button.tsx",
          description: "Primary button",
          exports: ["export function Button()"],
        },
      ],
      utils: [
        {
          name: "formatDate",
          file: "src/utils/format.ts",
          description: "Format dates",
          exports: ["export function formatDate(d: Date): string"],
        },
      ],
      enums: [
        {
          name: "UserRole",
          file: "src/enums/UserRole.ts",
          description: "User roles",
          members: ["Admin", "User"],
        },
      ],
    },
  ],
};

describe("chunkStructuredEntities", () => {
  it("creates one L1 chunk per api, rpc, component, util, and enum with embedding prefix", () => {
    const chunks = chunkStructuredEntities(fixtureModel);

    expect(chunks).toHaveLength(5);

    const api = chunks.find((c) => c.kind === "api");
    expect(api).toMatchObject({
      path: "backend/auth/api",
      anchor: "POST-/auth/login",
      kind: "api",
      title: "POST /auth/login",
    });
    expect(api?.text).toBe(
      "[kind:api][module:auth][tags:auth,frontend-facing][audience:frontend-facing]\nPOST /auth/login — User login"
    );

    const rpc = chunks.find((c) => c.kind === "rpc");
    expect(rpc).toMatchObject({
      path: "backend/auth/rpc",
      anchor: "UserClient#getUser",
      kind: "rpc",
      title: "UserClient#getUser",
    });
    expect(rpc?.text).toBe(
      "[kind:rpc][module:auth]\nUserClient#getUser — Fetch user by id"
    );

    const component = chunks.find((c) => c.kind === "component");
    expect(component).toMatchObject({
      path: "frontend/ui/components",
      anchor: "Button",
      kind: "component",
      title: "Button",
    });
    expect(component?.text).toContain("Primary button");
    expect(component?.text).toContain("export function Button()");

    const util = chunks.find((c) => c.kind === "util");
    expect(util).toMatchObject({
      path: "frontend/ui/utils",
      anchor: "formatDate",
      kind: "util",
      title: "formatDate",
    });
    expect(util?.text).toContain("Format dates");

    const enumChunk = chunks.find((c) => c.kind === "enum");
    expect(enumChunk).toMatchObject({
      path: "frontend/ui/enums",
      anchor: "UserRole",
      kind: "enum",
      title: "UserRole",
    });
    expect(enumChunk?.text).toContain("Members: Admin, User");

    for (const chunk of chunks) {
      expect(chunk.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    }
  });
});

describe("callSemanticSplit", () => {
  const originalFetch = globalThis.fetch;
  const longMarkdown = "# Auth\n\n" + "Login flow details. ".repeat(200);

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("parses chat completion JSON chunks from fetch", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                chunks: [
                  {
                    title: "Auth overview",
                    text: "Login flow for frontend apps.",
                    keywords: ["auth", "login"],
                  },
                ],
              }),
            },
          },
        ],
      }),
    }) as typeof fetch;

    const chunks = await callSemanticSplit(
      DEFAULT_CONFIG,
      longMarkdown,
      { path: "backend/auth/overview", kind: "overview" }
    );

    expect(chunks).toEqual([
      {
        title: "Auth overview",
        text: "Login flow for frontend apps.",
        keywords: ["auth", "login"],
      },
    ]);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${DEFAULT_CONFIG.chunking.baseUrl}/chat/completions`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      })
    );
  });

  it("throws when the API responds with a non-OK status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "upstream unavailable",
    }) as typeof fetch;

    await expect(
      callSemanticSplit(DEFAULT_CONFIG, longMarkdown, {
        path: "backend/auth/overview",
        kind: "overview",
      })
    ).rejects.toThrow(/Semantic split failed: 503/);
  }, 15000);

  it("uses local single chunk for short markdown without calling fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const chunks = await callSemanticSplit(
      DEFAULT_CONFIG,
      "# base\n\nModule path: `services/base`\n",
      { path: "backend/base/overview", kind: "overview" }
    );

    expect(chunks).toEqual([
      {
        title: "base",
        text: "# base\n\nModule path: `services/base`",
        keywords: [],
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to local chunk when model returns empty chunks", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ chunks: [] }) } }],
      }),
    }) as typeof fetch;

    const chunks = await callSemanticSplit(
      DEFAULT_CONFIG,
      longMarkdown,
      { path: "backend/auth/overview", kind: "overview" }
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.title).toBe("Auth");
    expect(chunks[0]?.text).toContain("Login flow details.");
  });
});

describe("splitOversizedChunks", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("recursively splits chunks that exceed the token estimate", async () => {
    const oversizedText = "word ".repeat(900);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chunks: [
                    { title: "Part A", text: "Short A.", keywords: ["a"] },
                    { title: "Part B", text: "Short B.", keywords: ["b"] },
                  ],
                }),
              },
            },
          ],
        }),
      });

    globalThis.fetch = fetchMock as typeof fetch;

    const result = await splitOversizedChunks(
      DEFAULT_CONFIG,
      [{ title: "Big", text: oversizedText, keywords: ["big"] }],
      800,
      { path: "backend/auth/overview", kind: "overview" }
    );

    expect(result).toEqual([
      { title: "Part A", text: "Short A.", keywords: ["a"] },
      { title: "Part B", text: "Short B.", keywords: ["b"] },
    ]);
    expect(estimateTokens(oversizedText)).toBeGreaterThan(800);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("buildAllChunks", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("combines L1 structured chunks with L2 overview semantic chunks", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const overviewMarkdowns = new Map([
      ["frontend/ui/overview", "# @app/ui\n\nShared UI package."],
    ]);

    const chunks = await buildAllChunks(
      DEFAULT_CONFIG,
      fixtureModel,
      overviewMarkdowns
    );

    expect(chunks).toHaveLength(6);
    expect(fetchMock).not.toHaveBeenCalled();

    const overview = chunks.find((c) => c.kind === "overview");
    expect(overview).toMatchObject({
      path: "frontend/ui/overview",
      kind: "overview",
      title: "@app/ui",
    });
    expect(overview?.text).toBe(
      "[kind:overview][path:frontend/ui/overview]\n# @app/ui\n\nShared UI package."
    );

    expect(chunks.filter((c) => c.kind !== "overview")).toHaveLength(5);
  });
});

describe("local split helpers", () => {
  it("shouldUseLocalSplit is true when content fits maxChunkTokens", () => {
    expect(shouldUseLocalSplit("short doc", DEFAULT_CONFIG.chunking.maxChunkTokens)).toBe(
      true
    );
  });

  it("localSingleChunk derives title from markdown heading", () => {
    expect(
      localSingleChunk("# My Module\n\nDetails.", { path: "backend/x/overview" })
    ).toEqual([
      {
        title: "My Module",
        text: "# My Module\n\nDetails.",
        keywords: [],
      },
    ]);
  });
});
