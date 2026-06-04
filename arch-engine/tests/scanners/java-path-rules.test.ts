import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  antPackageMatch,
  applyPathRulesToEndpointPath,
  prefixForControllerPackage,
  resolveJavaPathRules,
} from "../../src/scanners/java-path-rules.js";

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

  it("applyPathRulesToEndpointPath adds admin-api prefix for admin controllers", async () => {
    const rules = await resolveJavaPathRules(tmpRoot);
    const pkg = "cn.example.module.controller.admin.auth";
    expect(prefixForControllerPackage(rules, pkg)).toBe("/admin-api");
    expect(
      applyPathRulesToEndpointPath(rules, pkg, "/system/oauth2/user")
    ).toBe("/admin-api/system/oauth2/user");
  });
});
