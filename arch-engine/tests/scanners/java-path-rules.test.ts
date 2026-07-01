import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArchConfig } from "../../src/types.js";
import {
  antPackageMatch,
  applyPathRulesToEndpointPath,
  mergePathRules,
  prefixForControllerPackage,
  resolveJavaPathRules,
} from "../../src/scanners/java-path-rules.js";
import { writePathRulesSnapshot } from "../../src/writer/path-rules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configurerOnlyFixture = path.join(
  __dirname,
  "..",
  "fixtures",
  "java-path-rules",
  "configurer-only"
);
const starterOnlyFixture = path.join(
  __dirname,
  "..",
  "fixtures",
  "java-path-rules",
  "starter-only"
);

const WEB_PROPERTIES = `
@ConfigurationProperties(prefix = "base.web")
public class WebProperties {
    private Api adminApi = new Api("/admin-api", "**.controller.admin.**");
    private Api appApi = new Api("/app-api", "**.controller.app.**");
    private Api pcApi = new Api("/pc-api", "**.controller.pc.**");
}
`;

const WEB_MVC_CONFIG = `
@EnableConfigurationProperties(WebProperties.class)
public class BaseWebAutoConfiguration {
    @Bean
    public WebMvcRegistrations webMvcRegistrations(WebProperties webProperties) {
        return new WebMvcRegistrations() { };
    }
}
`;

describe("java-path-rules", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "path-rules-"));
    const pkgDir = path.join(
      tmpRoot,
      "src/main/java/cn/example/framework/web/config"
    );
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(path.join(pkgDir, "WebProperties.java"), WEB_PROPERTIES);
    await fs.writeFile(
      path.join(pkgDir, "BaseWebAutoConfiguration.java"),
      WEB_MVC_CONFIG
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("antPackageMatch matches yudao controller package patterns", () => {
    expect(
      antPackageMatch(
        "**.controller.admin.**",
        "cn.iocoder.base.module.system.controller.admin.oauth2"
      )
    ).toBe(true);
    expect(
      antPackageMatch("**.controller.admin.**", "com.example.controller.admin")
    ).toBe(true);
    expect(
      antPackageMatch(
        "**.controller.app.**",
        "cn.iocoder.base.module.system.controller.admin.oauth2"
      )
    ).toBe(false);
  });

  it("resolveJavaPathRules discovers WebMvcRegistrations → WebProperties defaults", async () => {
    const rules = await resolveJavaPathRules(tmpRoot);
    expect(rules.confidence).toBe("high");
    expect(rules.controllerPrefixes).toHaveLength(3);
    expect(rules.controllerPrefixes.map((r) => r.prefix).sort()).toEqual([
      "/admin-api",
      "/app-api",
      "/pc-api",
    ]);
  });

  it("resolveJavaPathRules discovers WebProperties direct without WebMvcRegistrations", async () => {
    const onlyPropsRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "path-rules-props-only-")
    );
    try {
      const pkgDir = path.join(
        onlyPropsRoot,
        "src/main/java/cn/example/framework/web/config"
      );
      await fs.mkdir(pkgDir, { recursive: true });
      await fs.writeFile(path.join(pkgDir, "WebProperties.java"), WEB_PROPERTIES);
      expect(WEB_PROPERTIES).not.toMatch(/WebMvcRegistrations/);

      const rules = await resolveJavaPathRules(onlyPropsRoot);
      expect(rules.confidence).toBe("high");
      expect(rules.controllerPrefixes).toHaveLength(3);
      expect(rules.controllerPrefixes.map((r) => r.prefix).sort()).toEqual([
        "/admin-api",
        "/app-api",
        "/pc-api",
      ]);
      expect(
        rules.controllerPrefixes.every((r) =>
          r.source.includes("WebProperties.java")
        )
      ).toBe(true);
    } finally {
      await fs.rm(onlyPropsRoot, { recursive: true, force: true });
    }
  });

  it("applyPathRulesToEndpointPath adds admin-api prefix for admin controllers", async () => {
    const rules = await resolveJavaPathRules(tmpRoot);
    const pkg = "cn.example.module.controller.admin.auth";
    expect(prefixForControllerPackage(rules, pkg)).toBe("/admin-api");
    expect(
      applyPathRulesToEndpointPath(rules, pkg, "/system/oauth2/user")
    ).toBe("/admin-api/system/oauth2/user");
  });

  it("manual overrides auto on same controllerPattern", async () => {
    const config = {
      java: {
        controllerPathPrefixes: [
          {
            prefix: "/custom-admin-api",
            controllerPattern: "**.controller.admin.**",
          },
        ],
      },
    } as ArchConfig;

    const rules = await resolveJavaPathRules(tmpRoot, config);
    const adminRule = rules.controllerPrefixes.find(
      (r) => r.controllerPattern === "**.controller.admin.**"
    );
    expect(adminRule?.prefix).toBe("/custom-admin-api");
    expect(adminRule?.source).toBe("manual");
    expect(adminRule?.overrides).toMatch(/field:adminApi/);
    expect(rules.controllerPrefixes).toHaveLength(3);
    expect(rules.confidence).toBe("high");
    expect(rules.sources).toContain("manual");
  });

  it("manual-only rules yield confidence medium", async () => {
    const emptyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "path-rules-manual-"));
    try {
      const config = {
        java: {
          controllerPathPrefixes: [
            {
              prefix: "/api",
              controllerPattern: "**.controller.**",
            },
          ],
        },
      } as ArchConfig;

      const rules = await resolveJavaPathRules(emptyRoot, config);
      expect(rules.confidence).toBe("medium");
      expect(rules.controllerPrefixes).toHaveLength(1);
      expect(rules.controllerPrefixes[0]?.source).toBe("manual");
      expect(rules.controllerPrefixes[0]?.overrides).toBeNull();
      expect(rules.sources).toContain("manual");
    } finally {
      await fs.rm(emptyRoot, { recursive: true, force: true });
    }
  });

  it("mergePathRules preserves non-overridden auto rules", async () => {
    const auto = await resolveJavaPathRules(tmpRoot);
    const merged = mergePathRules(auto, [
      {
        prefix: "/custom-admin-api",
        controllerPattern: "**.controller.admin.**",
      },
    ]);
    expect(merged.controllerPrefixes.map((r) => r.prefix).sort()).toEqual([
      "/app-api",
      "/custom-admin-api",
      "/pc-api",
    ]);
  });

  it("writePathRulesSnapshot writes path-rules.json", async () => {
    const rules = await resolveJavaPathRules(tmpRoot);
    await writePathRulesSnapshot(tmpRoot, rules);

    const snapshotPath = path.join(tmpRoot, ".ai", "arch", "path-rules.json");
    const raw = await fs.readFile(snapshotPath, "utf-8");
    const snapshot = JSON.parse(raw) as {
      confidence: string;
      rules: { source: string; file?: string; overrides?: string | null }[];
    };
    expect(snapshot.confidence).toBe("high");
    expect(snapshot.rules).toHaveLength(3);
    const appRule = snapshot.rules.find((r) => r.source.includes("appApi"));
    expect(appRule?.file).toMatch(/WebProperties\.java$/);
    expect(appRule?.overrides).toBeNull();
  });

  it("resolveJavaPathRules discovers WebMvcConfigurer addPathPrefix without WebMvcRegistrations", async () => {
    const configContent = await fs.readFile(
      path.join(
        configurerOnlyFixture,
        "src/main/java/cn/example/framework/web/config/WebMvcConfig.java"
      ),
      "utf-8"
    );
    expect(configContent).toMatch(/implements\s+WebMvcConfigurer/);
    expect(configContent).toMatch(/addPathPrefix/);
    expect(configContent).not.toMatch(/WebMvcRegistrations/);

    const rules = await resolveJavaPathRules(configurerOnlyFixture);
    expect(rules.confidence).toBe("medium");
    expect(rules.controllerPrefixes).toHaveLength(1);
    expect(rules.controllerPrefixes[0]?.prefix).toBe("/admin-api");
    expect(rules.controllerPrefixes[0]?.controllerPattern).toBe(
      "**.controller.admin.**"
    );
    expect(rules.controllerPrefixes[0]?.source).toContain(":configurer");
    expect(rules.controllerPrefixes[0]?.file).toMatch(/WebMvcConfig\.java$/);
  });

  it("resolveJavaPathRules on starter-only fixture finds /admin-api via AutoConfiguration chain", async () => {
    const autoConfig = await fs.readFile(
      path.join(
        starterOnlyFixture,
        "src/main/java/com/example/framework/web/config/BaseWebAutoConfiguration.java"
      ),
      "utf-8"
    );
    expect(autoConfig).not.toMatch(/WebMvcRegistrations/);
    expect(autoConfig).toMatch(/@AutoConfiguration/);

    const rules = await resolveJavaPathRules(starterOnlyFixture);
    expect(rules.confidence).toBe("high");
    expect(rules.controllerPrefixes.map((r) => r.prefix).sort()).toEqual([
      "/admin-api",
      "/app-api",
    ]);
    expect(
      rules.controllerPrefixes.some((r) =>
        r.source.includes("WebProperties.java")
      )
    ).toBe(true);
  });
});
