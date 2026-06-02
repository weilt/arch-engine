import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseOpenApiFile,
  scanOpenApiGlobs,
} from "../../src/scanners/openapi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "..", "fixtures");
const archEngineRoot = path.join(__dirname, "..", "..");

describe("openapi scanner", () => {
  it("parseOpenApiFile on petstore returns >=2 ApiEndpoint with correct method/path", async () => {
    const petstorePath = path.join(fixturesRoot, "openapi", "petstore.json");
    const endpoints = await parseOpenApiFile(petstorePath, "openapi");

    expect(endpoints.length).toBeGreaterThanOrEqual(2);

    const getPets = endpoints.find(
      (e) => e.method === "GET" && e.path === "/pets"
    );
    expect(getPets).toBeDefined();
    expect(getPets?.summary).toBe("List pets");
    expect(getPets?.tags).toEqual(["pets"]);
    expect(getPets?.source).toBe("openapi");
    expect(getPets?.audience).toBe("frontend-facing");
    expect(getPets?.moduleSlug).toBe("openapi");
    expect(getPets?.id).toBe("GET-/pets");

    const postPets = endpoints.find(
      (e) => e.method === "POST" && e.path === "/pets"
    );
    expect(postPets).toBeDefined();
    expect(postPets?.summary).toBe("Create pet");
    expect(postPets?.id).toBe("POST-/pets");
  });

  it("apifox fixture parses", async () => {
    const apifoxPath = path.join(fixturesRoot, "apifox", "export.json");
    const endpoints = await parseOpenApiFile(apifoxPath, "apifox");

    expect(endpoints.length).toBeGreaterThanOrEqual(1);

    const listUsers = endpoints.find(
      (e) => e.method === "GET" && e.path === "/users"
    );
    expect(listUsers).toBeDefined();
    expect(listUsers?.summary).toBe("List users");
    expect(listUsers?.source).toBe("openapi");
    expect(listUsers?.moduleSlug).toBe("apifox");

    const health = endpoints.find(
      (e) => e.method === "GET" && e.path === "/internal/health"
    );
    expect(health).toBeDefined();
    expect(health?.audience).toBe("internal");
  });

  it("scanOpenApiGlobs on fixtures dir finds files", async () => {
    const endpoints = await scanOpenApiGlobs(archEngineRoot, [
      "tests/fixtures/**/*.json",
    ]);

    expect(endpoints.length).toBeGreaterThanOrEqual(3);

    const methodsAndPaths = endpoints.map((e) => `${e.method} ${e.path}`);
    expect(methodsAndPaths).toContain("GET /pets");
    expect(methodsAndPaths).toContain("POST /pets");
    expect(methodsAndPaths).toContain("GET /users");

    const moduleSlugs = new Set(endpoints.map((e) => e.moduleSlug));
    expect(moduleSlugs.has("openapi")).toBe(true);
    expect(moduleSlugs.has("apifox")).toBe(true);
  });
});
