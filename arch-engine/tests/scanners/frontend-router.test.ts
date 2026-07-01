import { describe, expect, it } from "vitest";
import {
  extractRoutes,
  isRouterFile,
} from "../../src/scanners/frontend-router.js";

describe("isRouterFile", () => {
  it("is true for a vue-router 4 createRouter file", () => {
    const content = [
      "import { createRouter, createWebHistory } from 'vue-router';",
      "const router = createRouter({ history: createWebHistory(), routes: [] });",
      "export default router;",
      "",
    ].join("\n");
    expect(isRouterFile(content)).toBe(true);
  });

  it("is true for a vue-router 3 new VueRouter file", () => {
    const content = "export default new VueRouter({ routes: [] });\n";
    expect(isRouterFile(content)).toBe(true);
  });

  it("is true for a React <Route> file", () => {
    const content = [
      "export function App() {",
      "  return <Route path='/x' element={<X/>} />;",
      "}",
      "",
    ].join("\n");
    expect(isRouterFile(content)).toBe(true);
  });

  it("is false for a plain module with no router construct", () => {
    const content = "export const value = 42;\nexport function add(a, b) { return a + b; }\n";
    expect(isRouterFile(content)).toBe(false);
  });
});

describe("extractRoutes", () => {
  it("extracts a flat createRouter route table with path/name/component", () => {
    const content = [
      "import { createRouter } from 'vue-router';",
      "const routes = [",
      "  { path: '/users', name: 'users', component: UserList },",
      "  { path: '/about', component: () => import('@/views/About.vue') },",
      "];",
      "export default createRouter({ routes });",
      "",
    ].join("\n");
    const routes = extractRoutes(content);
    expect(routes.map((r) => r.path)).toEqual(["/users", "/about"]);
    const users = routes.find((r) => r.path === "/users");
    expect(users?.name).toBe("users");
    expect(users?.component).toBe("UserList");
  });

  it("keeps the import path for () => import('...') components", () => {
    const content = [
      "import { createRouter } from 'vue-router';",
      "const routes = [",
      "  { path: '/home', component: () => import('@/views/Home.vue') },",
      "];",
      "export default createRouter({ routes });",
      "",
    ].join("\n");
    const routes = extractRoutes(content);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.component).toBe("@/views/Home.vue");
  });

  it("flattens nested children and concatenates parent + child paths", () => {
    const content = [
      "import { createRouter } from 'vue-router';",
      "const routes = [",
      "  {",
      "    path: '/admin',",
      "    component: AdminLayout,",
      "    children: [",
      "      { path: 'users', component: AdminUsers },",
      "      { path: 'settings' },",
      "    ],",
      "  },",
      "];",
      "export default createRouter({ routes });",
      "",
    ].join("\n");
    const paths = extractRoutes(content).map((r) => r.path).sort();
    expect(paths).toEqual(["/admin", "/admin/settings", "/admin/users"]);
  });

  it("normalizes double slashes when joining parent and child paths", () => {
    const content = [
      "const routes = [",
      "  { path: '/admin/', children: [ { path: '/users', component: X } ] },",
      "];",
      "export default createRouter({ routes });",
      "",
    ].join("\n");
    const paths = extractRoutes(content).map((r) => r.path).sort();
    expect(paths).toEqual(["/admin", "/admin/users"]);
  });

  it("walks deeply nested children (grandchildren)", () => {
    const content = [
      "const routes = [",
      "  { path: '/a', children: [",
      "    { path: 'b', children: [ { path: 'c', component: C } ] },",
      "  ] },",
      "];",
      "createRouter({ routes });",
      "",
    ].join("\n");
    const paths = extractRoutes(content).map((r) => r.path).sort();
    expect(paths).toEqual(["/a", "/a/b", "/a/b/c"]);
  });

  it("extracts title/hidden from a meta object", () => {
    const content = [
      "const routes = [",
      "  { path: '/x', meta: { title: 'X', hidden: true } },",
      "];",
      "createRouter({ routes });",
      "",
    ].join("\n");
    const routes = extractRoutes(content);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.meta).toEqual({ title: "X", hidden: true });
  });

  it("supports new VueRouter (vue-router 3)", () => {
    const content = [
      "import VueRouter from 'vue-router';",
      "const routes = [{ path: '/login', name: 'login', component: Login }];",
      "export default new VueRouter({ routes });",
      "",
    ].join("\n");
    const routes = extractRoutes(content);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.path).toBe("/login");
    expect(routes[0]!.name).toBe("login");
    expect(routes[0]!.component).toBe("Login");
  });

  it("extracts React <Route path=...> entries", () => {
    const content = [
      "export function App() {",
      "  return (",
      "    <Routes>",
      "      <Route path='/home' element={<Home/>} />",
      "      <Route path='/settings' element={<Settings/>} />",
      "    </Routes>",
      "  );",
      "}",
      "",
    ].join("\n");
    const routes = extractRoutes(content);
    expect(routes.map((r) => r.path).sort()).toEqual(["/home", "/settings"]);
    const home = routes.find((r) => r.path === "/home");
    expect(home?.component).toBe("Home");
  });

  it("returns an empty array when there are no routes and no <Route", () => {
    const content = [
      "export function helper() { return 1; }",
      "export const value = 42;",
      "",
    ].join("\n");
    expect(extractRoutes(content)).toEqual([]);
    expect(isRouterFile(content)).toBe(false);
  });

  it("returns an empty array when a router construct has an empty routes table", () => {
    const content = [
      "import { createRouter } from 'vue-router';",
      "export default createRouter({ routes: [] });",
      "",
    ].join("\n");
    expect(extractRoutes(content)).toEqual([]);
  });
});
