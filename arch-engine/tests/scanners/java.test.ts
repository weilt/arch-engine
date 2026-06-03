import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findMavenModules,
  scanJavaSources,
} from "../../src/scanners/java.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "..", "fixtures");
const javaModuleRoot = path.join(fixturesRoot, "java-module");

describe("java scanner", () => {
  it("findMavenModules discovers java-module from pom.xml", async () => {
    const modules = await findMavenModules(javaModuleRoot);

    expect(modules.length).toBeGreaterThanOrEqual(1);

    const javaModule = modules.find((m) => m.slug === "java-module");
    expect(javaModule).toBeDefined();
    expect(javaModule?.name).toBe("java-module");
    expect(javaModule?.path).toBe("");
  });

  it("scanJavaSources finds POST /auth/login api and feign UserClient rpc", async () => {
    const modules = await findMavenModules(javaModuleRoot);
    const { apis, rpcs } = await scanJavaSources(javaModuleRoot, modules);

    const login = apis.find(
      (a) => a.method === "POST" && a.path === "/auth/login"
    );
    expect(login).toBeDefined();
    expect(login?.source).toBe("java");
    expect(login?.moduleSlug).toBe("java-module");
    expect(login?.id).toBe("POST-/auth/login");
    expect(login?.audience).toBe("frontend-facing");

    const userClient = rpcs.find((r) => r.name === "UserClient");
    expect(userClient).toBeDefined();
    expect(userClient?.id).toBe("feign-UserClient");
    expect(userClient?.source).toBe("java");
    expect(userClient?.moduleSlug).toBe("java-module");
    expect(userClient?.summary).toContain("UserClient");
    expect(userClient?.summary).toContain("user-service");
  });
});
