import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadOrInitConfig } from "../../src/config.js";
import { getArchDir, getArchIndexPath } from "../../src/paths.js";
import {
  findMavenModules,
  scanJavaSources,
} from "../../src/scanners/java.js";
import { resolveJavaPathRules } from "../../src/scanners/java-path-rules.js";
import { mergeDocumentModel } from "../../src/scanners/merge.js";
import { runReindexApis } from "../../src/reindex/apis.js";
import type { ArchConfig } from "../../src/types.js";
import {
  buildArchIndex,
  writeArchIndex,
  writeIndexMd,
} from "../../src/writer/arch-index.js";
import { renderApiMd, writeApiDocsForModel } from "../../src/writer/markdown.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "..", "fixtures");
const javaModuleFixture = path.join(fixturesRoot, "java-module");

async function setupReindexProject(tmpRoot: string): Promise<void> {
  await fs.cp(javaModuleFixture, tmpRoot, { recursive: true });

  // Simulate rules living only in a dependency JAR (no framework sources in workspace).
  const webConfigDir = path.join(
    tmpRoot,
    "src/main/java/com/example/framework/web/config"
  );
  await fs.rm(path.join(webConfigDir, "DemoWebAutoConfiguration.java"), { force: true });
  await fs.rm(path.join(webConfigDir, "WebProperties.java"), { force: true });

  const archDir = path.join(tmpRoot, ".ai", "arch");
  await fs.mkdir(archDir, { recursive: true });

  const config: ArchConfig = {
    ...DEFAULT_CONFIG,
    scanners: { java: true, frontend: false },
    apiSpecGlobs: [],
    java: {
      controllerPathPrefixes: [
        {
          prefix: "/admin-api",
          controllerPattern: "**.controller.admin.**",
        },
      ],
    },
  };
  await fs.writeFile(
    path.join(archDir, "arch.config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );

  const modules = await findMavenModules(tmpRoot);
  const moduleSlug = modules[0]!.slug;
  const { apis, rpcs } = await scanJavaSources(tmpRoot, modules, undefined, config);
  const adminHello = apis.find((a) => a.method === "GET" && a.path.endsWith("/demo/hello"));
  expect(adminHello?.path).toContain("/admin-api");

  const model = mergeDocumentModel(apis, [], rpcs, modules, []);

  const index = buildArchIndex(model);
  await writeArchIndex(tmpRoot, index);
  await writeIndexMd(tmpRoot, index);

  // Stale api.md without controller path prefix (pre-reindex state).
  const staleApiMd = `# API

## GET /demo/hello

GET /demo/hello

Audience: frontend-facing
Source: java

`;
  await fs.mkdir(path.join(archDir, "backend", moduleSlug), { recursive: true });
  await fs.writeFile(path.join(archDir, "backend", moduleSlug, "api.md"), staleApiMd, "utf-8");

  await fs.writeFile(
    path.join(archDir, "last-scan.json"),
    JSON.stringify(
      {
        version: 2,
        commit: "abc123",
        branch: "main",
        scannedAt: new Date().toISOString(),
        modules: {},
        packages: {},
      },
      null,
      2
    ),
    "utf-8"
  );
}

describe("runReindexApis", () => {
  let tmpRoot: string;
  let moduleSlug: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "reindex-apis-"));
    process.env.OPENAI_API_KEY = "test";
    await setupReindexProject(tmpRoot);
    const modules = await findMavenModules(tmpRoot);
    moduleSlug = modules[0]!.slug;
  });

  afterEach(async () => {
    delete process.env.OPENAI_API_KEY;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("writeApiDocsForModel persists prefixed API paths", async () => {
    const { config } = await loadOrInitConfig(tmpRoot);
    const modules = await findMavenModules(tmpRoot);
    const rules = await resolveJavaPathRules(tmpRoot, config);
    const { apis, rpcs } = await scanJavaSources(tmpRoot, modules, rules, config);
    const model = mergeDocumentModel(apis, [], rpcs, modules, []);

    const moduleApis = model.apis.filter((a) => a.moduleSlug === moduleSlug);
    expect(renderApiMd(moduleApis)).toContain("/admin-api");

    const apiPath = path.join(getArchDir(tmpRoot), "backend", moduleSlug, "api.md");
    const count = await writeApiDocsForModel(tmpRoot, model);
    expect(count).toBe(1);

    const apiMd = await fs.readFile(apiPath, "utf-8");
    expect(apiMd).toContain("/admin-api");
  });

  it("rewrites api.md with manual admin-api prefix and updates arch index", async () => {
    const apiPath = path.join(getArchDir(tmpRoot), "backend", moduleSlug, "api.md");
    const beforeMtime = (await fs.stat(apiPath)).mtimeMs;

    const stale = await fs.readFile(apiPath, "utf-8");
    expect(stale).toContain("GET /demo/hello");
    expect(stale).not.toContain("/admin-api");

    const report = await runReindexApis(tmpRoot, {
      embedTextsFn: async (_cfg, texts) => texts.map(() => [0.1, 0.2, 0.3]),
    });

    const afterMtime = (await fs.stat(apiPath)).mtimeMs;
    expect(afterMtime).toBeGreaterThanOrEqual(beforeMtime);

    expect(report.apiCount).toBeGreaterThan(0);
    expect(report.modulesUpdated).toBeGreaterThanOrEqual(1);

    const apiMd = await fs.readFile(apiPath, "utf-8");
    expect(apiMd).toContain("/admin-api");
    expect(apiMd).toMatch(/## GET \/admin-api\/demo\/hello/);

    const pathRulesPath = path.join(getArchDir(tmpRoot), "path-rules.json");
    const pathRules = JSON.parse(await fs.readFile(pathRulesPath, "utf-8")) as {
      confidence: string;
      rules: {
        prefix: string;
        source: string;
        controllerPattern: string;
        overrides?: string | null;
      }[];
      sources: string[];
    };
    expect(pathRules.confidence).toBe("medium");
    const adminRule = pathRules.rules.find((r) => r.prefix === "/admin-api");
    expect(adminRule?.source).toBe("manual");
    expect(adminRule?.controllerPattern).toBe("**.controller.admin.**");
    expect(adminRule?.overrides).toBeNull();
    expect(pathRules.sources).toEqual(["manual"]);

    const index = JSON.parse(
      await fs.readFile(getArchIndexPath(tmpRoot), "utf-8")
    ) as {
      nodes: Record<string, { anchors?: string[]; keywords?: string[] }>;
    };
    const apiNode = index.nodes[`backend/${moduleSlug}/api`];
    expect(apiNode?.keywords?.some((k) => k.includes("/admin-api"))).toBe(true);
    expect(apiNode?.anchors?.some((a) => a.includes("/admin-api"))).toBe(true);
  });
});
