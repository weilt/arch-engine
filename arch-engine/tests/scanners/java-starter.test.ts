import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverJavaCandidates } from "../../src/scanners/java-assets.js";
import {
  discoverJavaStarterCandidates,
  isStarterModule,
} from "../../src/scanners/java-starter.js";
import { findMavenModules } from "../../src/scanners/java.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const starterRoot = path.join(__dirname, "..", "fixtures", "java", "auth-starter");

describe("java starter scanner", () => {
  it("identifies starter module by directory name and pom artifactId", async () => {
    const modules = await findMavenModules(starterRoot);
    const authStarter = modules.find((m) => m.slug === "auth-starter");
    expect(authStarter).toBeDefined();
    expect(await isStarterModule(starterRoot, authStarter!)).toBe(true);
  });

  it("discovers module-level starter candidate with AutoConfiguration exports", async () => {
    const modules = await findMavenModules(starterRoot);
    const authStarter = modules.find((m) => m.slug === "auth-starter")!;

    const candidates = await discoverJavaStarterCandidates(starterRoot, authStarter);

    expect(candidates).toHaveLength(1);
    const starter = candidates[0]!;
    expect(starter.kind).toBe("starter");
    expect(starter.name).toBe("auth-starter");
    expect(starter.moduleSlug).toBe("auth-starter");
    expect(starter.javadoc).toContain("authentication");

    const exports = starter.signatures.join("\n");
    expect(exports).toContain("com.example.auth.AuthAutoConfiguration");
    expect(exports).toContain("com.example.auth.LegacyAuthConfiguration");
    expect(exports).toContain("@AutoConfiguration AuthAutoConfiguration");
    expect(exports).toContain("@Configuration LegacyAuthConfiguration");
  });

  it("does not classify @Configuration classes as util in starter modules", async () => {
    const modules = await findMavenModules(starterRoot);
    const authStarter = modules.find((m) => m.slug === "auth-starter")!;

    const candidates = await discoverJavaCandidates(starterRoot, authStarter);
    const configAsUtil = candidates.filter(
      (c) =>
        c.kind === "util" &&
        (c.name === "AuthAutoConfiguration" || c.name === "LegacyAuthConfiguration")
    );
    expect(configAsUtil).toHaveLength(0);

    expect(candidates.some((c) => c.kind === "util" && c.name === "AuthTokenHelper")).toBe(
      true
    );
  });
});
