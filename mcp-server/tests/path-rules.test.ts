import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@apt/arch-engine";
import {
  handleQueryPathRules,
  handleUpdateJavaPathRules,
} from "../src/path-rules.js";

describe("handleQueryPathRules", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-path-rules-query-"));
    await fs.mkdir(path.join(tmpRoot, ".ai", "arch"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns snapshot, java config, and pathRulesHash from temp project", async () => {
    const snapshot = {
      resolvedAt: "2026-07-01T00:00:00.000Z",
      contextPath: "",
      confidence: "medium" as const,
      rules: [
        {
          prefix: "/admin-api",
          controllerPattern: "**.controller.admin.**",
          source: "manual",
        },
      ],
      sources: ["manual"],
      warnings: [],
    };

    await fs.writeFile(
      path.join(tmpRoot, ".ai", "arch", "path-rules.json"),
      JSON.stringify(snapshot, null, 2),
      "utf-8"
    );
    await fs.writeFile(
      path.join(tmpRoot, ".ai", "arch", "arch.config.json"),
      JSON.stringify(
        {
          ...DEFAULT_CONFIG,
          java: {
            controllerPathPrefixes: [
              {
                prefix: "/admin-api",
                controllerPattern: "**.controller.admin.**",
                source: "manual",
              },
            ],
            extraSourceRoots: ["framework/web"],
          },
        },
        null,
        2
      ),
      "utf-8"
    );
    await fs.writeFile(
      path.join(tmpRoot, ".ai", "arch", "last-scan.json"),
      JSON.stringify(
        {
          version: 2,
          commit: "abc123",
          branch: "main",
          scannedAt: "2026-07-01T00:00:00.000Z",
          modules: {},
          packages: {},
          pathRulesHash: "hash-abc",
        },
        null,
        2
      ),
      "utf-8"
    );

    const result = await handleQueryPathRules(tmpRoot);

    expect(result.pathRulesFile).toBe(".ai/arch/path-rules.json");
    expect(result.snapshot).toEqual(snapshot);
    expect(result.java.controllerPathPrefixes).toHaveLength(1);
    expect(result.java.extraSourceRoots).toEqual(["framework/web"]);
    expect(result.pathRulesHash).toBe("hash-abc");
  });

  it("returns null snapshot when path-rules.json is missing", async () => {
    await fs.writeFile(
      path.join(tmpRoot, ".ai", "arch", "arch.config.json"),
      JSON.stringify(DEFAULT_CONFIG, null, 2),
      "utf-8"
    );

    const result = await handleQueryPathRules(tmpRoot);

    expect(result.snapshot).toBeNull();
    expect(result.java).toEqual({});
    expect(result.pathRulesHash).toBeUndefined();
  });
});

describe("handleUpdateJavaPathRules", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-path-rules-update-"));
    await fs.mkdir(path.join(tmpRoot, ".ai", "arch"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, ".ai", "arch", "arch.config.json"),
      JSON.stringify(DEFAULT_CONFIG, null, 2),
      "utf-8"
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("merges rules into arch.config without reindex", async () => {
    const result = await handleUpdateJavaPathRules(tmpRoot, {
      rules: [
        {
          prefix: "/admin-api",
          controllerPattern: "**.controller.admin.**",
          note: "admin portal",
        },
      ],
      reindex: false,
    });

    expect(result).toEqual({
      ok: true,
      pathRulesFile: ".ai/arch/path-rules.json",
      rulesApplied: 1,
    });

    const config = JSON.parse(
      await fs.readFile(path.join(tmpRoot, ".ai", "arch", "arch.config.json"), "utf-8")
    );
    expect(config.java.controllerPathPrefixes).toEqual([
      {
        prefix: "/admin-api",
        controllerPattern: "**.controller.admin.**",
        source: "manual",
        note: "admin portal",
      },
    ]);
  });

  it("updates extraSourceRoots when provided", async () => {
    await handleUpdateJavaPathRules(tmpRoot, {
      rules: [
        {
          prefix: "/app-api",
          controllerPattern: "**.controller.app.**",
        },
      ],
      extraSourceRoots: ["starter/web"],
      reindex: false,
    });

    const config = JSON.parse(
      await fs.readFile(path.join(tmpRoot, ".ai", "arch", "arch.config.json"), "utf-8")
    );
    expect(config.java.extraSourceRoots).toEqual(["starter/web"]);
  });

  it("rejects invalid prefix", async () => {
    await expect(
      handleUpdateJavaPathRules(tmpRoot, {
        rules: [
          {
            prefix: "admin-api",
            controllerPattern: "**.controller.admin.**",
          },
        ],
        reindex: false,
      })
    ).rejects.toThrow('must start with "/"');
  });
});
