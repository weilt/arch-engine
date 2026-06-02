import { describe, expect, it } from "vitest";
import { mergeDocumentModel } from "../../src/scanners/merge.js";
import type { ApiEndpoint, JavaModule } from "../../src/types.js";

const modules: JavaModule[] = [
  { slug: "auth", name: "auth", path: "auth" },
];

const javaApis: ApiEndpoint[] = [
  {
    id: "POST-/auth/login",
    method: "POST",
    path: "/auth/login",
    summary: "Java login",
    tags: [],
    audience: "frontend-facing",
    source: "java",
    moduleSlug: "auth",
  },
  {
    id: "GET-/auth/me",
    method: "GET",
    path: "/auth/me",
    summary: "Java profile",
    tags: [],
    audience: "frontend-facing",
    source: "java",
    moduleSlug: "auth",
  },
];

const openApis: ApiEndpoint[] = [
  {
    id: "POST-/auth/login",
    method: "POST",
    path: "/auth/login",
    summary: "OpenAPI login",
    tags: ["auth"],
    audience: "frontend-facing",
    source: "openapi",
    moduleSlug: "auth",
  },
];

describe("mergeDocumentModel", () => {
  it("prefers OpenAPI over Java for duplicate method:path keys", () => {
    const model = mergeDocumentModel(javaApis, openApis, [], modules, []);

    expect(model.modules).toEqual(modules);
    expect(model.apis).toHaveLength(2);

    const login = model.apis.find(
      (a) => a.method === "POST" && a.path === "/auth/login"
    );
    expect(login).toBeDefined();
    expect(login?.source).toBe("openapi");
    expect(login?.summary).toBe("OpenAPI login");

    const profile = model.apis.find(
      (a) => a.method === "GET" && a.path === "/auth/me"
    );
    expect(profile).toBeDefined();
    expect(profile?.source).toBe("java");
    expect(profile?.summary).toBe("Java profile");
  });
});
