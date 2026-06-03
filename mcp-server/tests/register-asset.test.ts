import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "@apt/arch-engine";
import { handleRegisterAsset } from "../src/register-asset.js";
import { handleSearchArch } from "../src/arch-query.js";

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/embeddings")) {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: body.input.map((text) => ({
            embedding: text.includes("字典") ? [1, 0] : [0.2, 0.8],
            index: 0,
          })),
        }),
      };
    }
    throw new Error(`Unexpected fetch URL: ${target}`);
  });
}

describe("handleRegisterAsset", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-register-asset-"));
    await fs.mkdir(path.join(tmpRoot, ".ai", "arch"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, ".ai", "arch", "arch.config.json"),
      JSON.stringify(DEFAULT_CONFIG, null, 2),
      "utf-8"
    );
    await fs.writeFile(
      path.join(tmpRoot, ".ai", "arch", "arch-index.json"),
      JSON.stringify(
        {
          root: "root",
          nodes: {
            root: {
              path: "root",
              kind: "root",
              title: "Architecture",
              summary: "",
              children: ["backend"],
              chunks: [],
              keywords: [],
            },
            backend: {
              path: "backend",
              kind: "module",
              title: "Backend",
              summary: "",
              children: ["backend/base-common"],
              chunks: [],
              keywords: [],
            },
            "backend/base-common": {
              path: "backend/base-common",
              kind: "module",
              title: "base-common",
              summary: "",
              children: [],
              chunks: [],
              keywords: [],
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );
    await fs.mkdir(path.join(tmpRoot, "base-common", "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, "base-common", "src", "DictHelper.java"),
      "public class DictHelper {}",
      "utf-8"
    );
    process.env.OPENAI_API_KEY = "test";
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(async () => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("registers util and becomes searchable with assetId and sourcePath", async () => {
    const result = await handleRegisterAsset(tmpRoot, {
      kind: "util",
      name: "DictHelper",
      module: "base-common",
      sourcePath: "base-common/src/DictHelper.java",
      summary: "字典 RPC 辅助工具",
      whenToUse: "需要字典数据时",
      howToUse: "注入后调用 getDict",
      tags: ["dict", "rpc"],
    });

    expect(result.id).toBe("backend/base-common/util/DictHelper");

    const hits = await handleSearchArch(tmpRoot, "字典 RPC", 5);
    const match = hits.find((h) => h.assetId === result.id);
    expect(match).toBeDefined();
    expect(match?.sourcePath).toBe("base-common/src/DictHelper.java");
    expect(match?.kind).toBe("util");
  });

  it("search_arch filter accepts starter and pojo kinds", async () => {
    await handleRegisterAsset(tmpRoot, {
      kind: "pojo",
      name: "UserDTO",
      module: "base-common",
      sourcePath: "base-common/src/DictHelper.java",
      summary: "用户 DTO",
      whenToUse: "传输用户数据",
      howToUse: "作为返回值",
    });

    const hits = await handleSearchArch(tmpRoot, "用户 DTO", 10, { kind: "pojo" });
    expect(hits.every((h) => h.kind === "pojo")).toBe(true);
  });
});
