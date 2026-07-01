import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { updateJavaPathRules } from "../../src/path-rules/update.js";
import { getArchConfigPath } from "../../src/paths.js";
import type { ApiEndpoint, ArchConfig } from "../../src/types.js";

describe("updateJavaPathRules", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function writeConfig(config: ArchConfig): Promise<void> {
    const configPath = getArchConfigPath(tmpDir);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  async function readConfig(): Promise<ArchConfig> {
    const raw = await fs.readFile(getArchConfigPath(tmpDir), "utf-8");
    return JSON.parse(raw) as ArchConfig;
  }

  it("merge mode upserts rules by controllerPattern and sets source manual", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "path-rules-update-"));
    await writeConfig({
      ...DEFAULT_CONFIG,
      java: {
        controllerPathPrefixes: [
          {
            prefix: "/admin-api",
            controllerPattern: "**.controller.admin.**",
            source: "manual",
          },
        ],
      },
    });

    const runReindexApisFn = vi.fn().mockResolvedValue({
      apiCount: 10,
      modulesUpdated: 1,
    });

    const result = await updateJavaPathRules(
      tmpDir,
      {
        rules: [
          {
            prefix: "/app-api",
            controllerPattern: "**.controller.app.**",
            note: "mobile",
          },
          {
            prefix: "/admin-api/v2",
            controllerPattern: "**.controller.admin.**",
          },
        ],
        reindex: false,
      },
      { runReindexApisFn }
    );

    expect(result).toEqual({
      ok: true,
      pathRulesFile: ".ai/arch/path-rules.json",
      rulesApplied: 2,
    });
    expect(runReindexApisFn).not.toHaveBeenCalled();

    const config = await readConfig();
    expect(config.java?.controllerPathPrefixes).toEqual(
      expect.arrayContaining([
        {
          prefix: "/app-api",
          controllerPattern: "**.controller.app.**",
          source: "manual",
          note: "mobile",
        },
        {
          prefix: "/admin-api/v2",
          controllerPattern: "**.controller.admin.**",
          source: "manual",
        },
      ])
    );
    expect(config.java?.controllerPathPrefixes).toHaveLength(2);
  });

  it("replace-manual mode clears existing manual rules before writing", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "path-rules-update-"));
    await writeConfig({
      ...DEFAULT_CONFIG,
      java: {
        controllerPathPrefixes: [
          {
            prefix: "/legacy",
            controllerPattern: "**.legacy.**",
            source: "manual",
          },
        ],
        extraSourceRoots: ["legacy-root"],
      },
    });

    await updateJavaPathRules(
      tmpDir,
      {
        mode: "replace-manual",
        rules: [
          {
            prefix: "/admin-api",
            controllerPattern: "**.controller.admin.**",
          },
        ],
        reindex: false,
      }
    );

    const config = await readConfig();
    expect(config.java?.controllerPathPrefixes).toEqual([
      {
        prefix: "/admin-api",
        controllerPattern: "**.controller.admin.**",
        source: "manual",
      },
    ]);
    expect(config.java?.extraSourceRoots).toEqual(["legacy-root"]);
  });

  it("updates extraSourceRoots when provided", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "path-rules-update-"));
    await writeConfig({ ...DEFAULT_CONFIG });

    await updateJavaPathRules(tmpDir, {
      rules: [{ prefix: "/api", controllerPattern: "**.api.**" }],
      extraSourceRoots: ["framework/starter"],
      reindex: false,
    });

    const config = await readConfig();
    expect(config.java?.extraSourceRoots).toEqual(["framework/starter"]);
  });

  it("writes arch.config.json atomically via temp file", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "path-rules-update-"));
    await writeConfig({ ...DEFAULT_CONFIG });

    await updateJavaPathRules(tmpDir, {
      rules: [{ prefix: "/api", controllerPattern: "**.api.**" }],
      reindex: false,
    });

    await expect(
      fs.access(getArchConfigPath(tmpDir) + ".tmp")
    ).rejects.toThrow();
    const config = await readConfig();
    expect(config.java?.controllerPathPrefixes?.[0]?.source).toBe("manual");
  });

  it("rejects prefix without leading slash", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "path-rules-update-"));
    await writeConfig({ ...DEFAULT_CONFIG });

    await expect(
      updateJavaPathRules(tmpDir, {
        rules: [{ prefix: "admin-api", controllerPattern: "**.admin.**" }],
        reindex: false,
      })
    ).rejects.toThrow('must start with "/"');
  });

  it("calls runReindexApis by default and returns spec reindex shape", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "path-rules-update-"));
    await writeConfig({ ...DEFAULT_CONFIG, scanners: { java: true, frontend: false } });

    const beforeApis: ApiEndpoint[] = [
      {
        id: "POST-/system/auth/login",
        method: "POST",
        path: "/system/auth/login",
        summary: "",
        tags: [],
        audience: "frontend-facing",
        source: "java",
        moduleSlug: "demo-module",
      },
    ];
    const afterApis: ApiEndpoint[] = [
      {
        id: "POST-/admin-api/system/auth/login",
        method: "POST",
        path: "/admin-api/system/auth/login",
        summary: "",
        tags: [],
        audience: "frontend-facing",
        source: "java",
        moduleSlug: "demo-module",
      },
    ];

    const runReindexApisFn = vi.fn().mockResolvedValue({
      apiCount: 1446,
      modulesUpdated: 1,
    });
    const scanApisFn = vi
      .fn()
      .mockResolvedValueOnce(beforeApis)
      .mockResolvedValueOnce(afterApis);

    const result = await updateJavaPathRules(
      tmpDir,
      {
        rules: [
          {
            prefix: "/admin-api",
            controllerPattern: "**.controller.admin.**",
          },
        ],
      },
      { runReindexApisFn, scanApisFn }
    );

    expect(runReindexApisFn).toHaveBeenCalledWith(tmpDir);
    expect(scanApisFn).toHaveBeenCalledTimes(2);
    expect(result.reindex).toEqual({
      apis: 1446,
      modulesUpdated: ["demo-module"],
      samplePaths: [
        {
          before: "POST /system/auth/login",
          after: "POST /admin-api/system/auth/login",
        },
      ],
    });
  });

  it("skips reindex when reindex is false", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "path-rules-update-"));
    await writeConfig({ ...DEFAULT_CONFIG });

    const runReindexApisFn = vi.fn();
    const scanApisFn = vi.fn();

    const result = await updateJavaPathRules(
      tmpDir,
      {
        rules: [{ prefix: "/api", controllerPattern: "**.api.**" }],
        reindex: false,
      },
      { runReindexApisFn, scanApisFn }
    );

    expect(result.reindex).toBeUndefined();
    expect(runReindexApisFn).not.toHaveBeenCalled();
    expect(scanApisFn).not.toHaveBeenCalled();
  });
});
