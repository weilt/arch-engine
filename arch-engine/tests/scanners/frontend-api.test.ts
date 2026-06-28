import { describe, expect, it } from "vitest";
import {
  extractApiClients,
  isApiClientFile,
} from "../../src/scanners/frontend-api.js";

describe("isApiClientFile", () => {
  it("is true for an axios client with fluent method calls", () => {
    const content = [
      "import axios from 'axios';",
      "const api = axios.create();",
      "api.get('/users');",
      "api.post('/users', payload);",
      "",
    ].join("\n");
    expect(isApiClientFile(content)).toBe(true);
  });

  it("is true for a request wrapper import (@/utils/request)", () => {
    const content = [
      "import request from '@/utils/request';",
      "export function getX() { return request.put('/x'); }",
      "export function getY() { return request.patch('/y'); }",
      "",
    ].join("\n");
    expect(isApiClientFile(content)).toBe(true);
  });

  it("is true for require('axios')", () => {
    const content = "const axios = require('axios'); axios.get('/health');";
    expect(isApiClientFile(content)).toBe(true);
  });

  it("is false when there is an import but no method calls", () => {
    const content = [
      "import request from '@/utils/request';",
      "export function helper() { return request; }",
      "",
    ].join("\n");
    expect(isApiClientFile(content)).toBe(false);
  });

  it("is false when there is no HTTP client import", () => {
    const content = [
      "import { ref } from 'vue';",
      "const data = fetcher.get('/x');",
      "",
    ].join("\n");
    expect(isApiClientFile(content)).toBe(false);
  });

  it("is false for a plain file with neither import nor calls", () => {
    const content = "export const value = 42;\n";
    expect(isApiClientFile(content)).toBe(false);
  });

  it("does not confuse .delete with .deletedFoo", () => {
    const content = [
      "import axios from 'axios';",
      "const api = axios.create();",
      "api.deletedFoo('/x');",
      "export const noop = api;",
      "",
    ].join("\n");
    expect(isApiClientFile(content)).toBe(false);
  });
});

describe("extractApiClients", () => {
  it("collects get/post/delete endpoints and preserves template paths", () => {
    const content = [
      "import axios from 'axios';",
      "const api = axios.create();",
      "api.get('/users');",
      "api.post('/users', payload);",
      "api.delete(`/users/${id}`);",
      "",
    ].join("\n");
    const contracts = extractApiClients(content, "src/api/user.js");
    expect(contracts).toHaveLength(1);
    const card = contracts[0]!;
    expect(card.endpoints).toEqual([
      { method: "GET", path: "/users" },
      { method: "POST", path: "/users" },
      { method: "DELETE", path: "/users/${id}" },
    ]);
    expect(card.file).toBe("src/api/user.js");
    expect(card.description).toBe("");
  });

  it("collects put/patch endpoints from a request wrapper", () => {
    const content = [
      "import request from '@/utils/request';",
      "request.put('/x');",
      "request.patch('/y');",
      "",
    ].join("\n");
    const contracts = extractApiClients(content, "src/api/x.js");
    expect(contracts).toHaveLength(1);
    expect(contracts[0]!.endpoints).toEqual([
      { method: "PUT", path: "/x" },
      { method: "PATCH", path: "/y" },
    ]);
  });

  it("records a <dynamic> placeholder when the first arg is not a literal", () => {
    const content = [
      "import axios from 'axios';",
      "const api = axios.create();",
      "api.get(url);",
      "api.post(buildPath(), body);",
      "",
    ].join("\n");
    const contracts = extractApiClients(content, "src/api/dyn.js");
    expect(contracts[0]!.endpoints).toEqual([
      { method: "GET", path: "<dynamic>" },
      { method: "POST", path: "<dynamic>" },
    ]);
  });

  it("de-duplicates identical (method, path) pairs within a file", () => {
    const content = [
      "import axios from 'axios';",
      "const api = axios.create();",
      "api.get('/users');",
      "api.get('/users');",
      "",
    ].join("\n");
    const contracts = extractApiClients(content, "src/api/dup.js");
    expect(contracts[0]!.endpoints).toEqual([
      { method: "GET", path: "/users" },
    ]);
  });

  it("prefers the first `export const X` as the client name", () => {
    const content = [
      "import request from '@/utils/request';",
      "export const userApi = {",
      "  list() { return request.get('/users'); },",
      "};",
      "",
    ].join("\n");
    const contracts = extractApiClients(content, "src/api/userApi.js");
    expect(contracts[0]!.name).toBe("userApi");
  });

  it("falls back to the file basename when no export const exists", () => {
    const content = [
      "import request from '@/utils/request';",
      "function load() { return request.get('/users'); }",
      "",
    ].join("\n");
    const contracts = extractApiClients(content, "src/api/foo.js");
    expect(contracts[0]!.name).toBe("foo");
  });

  it("returns an empty array when there are no method calls", () => {
    const content = [
      "import request from '@/utils/request';",
      "export const noop = () => null;",
      "",
    ].join("\n");
    expect(extractApiClients(content, "src/api/empty.js")).toEqual([]);
  });
});
