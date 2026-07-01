import { describe, expect, it } from "vitest";
import {
  extractStores,
  isStoreFile,
} from "../../src/scanners/frontend-store.js";

describe("isStoreFile", () => {
  it("is true for a Pinia defineStore", () => {
    expect(isStoreFile("export const s = defineStore('x', () => ({}));")).toBe(true);
  });

  it("is true for Vuex 3 (new Vuex.Store)", () => {
    expect(isStoreFile("export default new Vuex.Store({ state: {} });")).toBe(true);
  });

  it("is true for Vuex 4 (createStore)", () => {
    expect(isStoreFile("export default createStore({ state: {} });")).toBe(true);
  });

  it("is false for a plain file with no store definition", () => {
    expect(isStoreFile("export const value = 42;\n")).toBe(false);
  });
});

describe("extractStores", () => {
  it("classifies Pinia setup-store return keys (ref->state, computed->getter, function->action)", () => {
    const content = [
      "import { defineStore } from 'pinia';",
      "export const useUserStore = defineStore('user', () => {",
      "  const count = ref(0);",
      "  const double = computed(() => count.value * 2);",
      "  function increment() {}",
      "  return { count, double, increment };",
      "});",
      "",
    ].join("\n");
    const stores = extractStores(content, "src/stores/user.js");
    expect(stores).toHaveLength(1);
    const store = stores[0]!;
    expect(store.storeId).toBe("user");
    expect(store.name).toBe("user");
    expect(store.file).toBe("src/stores/user.js");
    expect(store.description).toBe("");
    expect(store.state).toEqual(["count"]);
    expect(store.getters).toEqual(["double"]);
    expect(store.actions).toEqual(["increment"]);
  });

  it("extracts keys from a Pinia options store (state factory + getters + actions)", () => {
    const content = [
      "defineStore('user', {",
      "  state: () => ({ count: 0 }),",
      "  getters: { double: (s) => s.count * 2 },",
      "  actions: { increment() {} },",
      "});",
      "",
    ].join("\n");
    const store = extractStores(content, "src/stores/user.js")[0]!;
    expect(store.storeId).toBe("user");
    expect(store.name).toBe("user");
    expect(store.state).toEqual(["count"]);
    expect(store.getters).toEqual(["double"]);
    expect(store.actions).toEqual(["increment"]);
  });

  it("extracts Vuex 3 state/getters/actions and folds mutations into actions", () => {
    const content = [
      "new Vuex.Store({",
      "  state: { count: 0 },",
      "  getters: { double: (s) => s.count * 2 },",
      "  actions: { increment({}) {} },",
      "  mutations: { setCount(s, v) {} },",
      "});",
      "",
    ].join("\n");
    const store = extractStores(content, "src/stores/index.js")[0]!;
    expect(store.storeId).toBeUndefined();
    // No string storeId -> falls back to the file basename.
    expect(store.name).toBe("index");
    expect(store.state).toEqual(["count"]);
    expect(store.getters).toEqual(["double"]);
    expect(store.actions).toEqual(["increment", "setCount"]);
  });

  it("extracts a Vuex 4 createStore with a factory state", () => {
    const content = [
      "createStore({",
      "  state: () => ({ count: 0 }),",
      "  getters: { double: (s) => s.count * 2 },",
      "  mutations: { setCount(s, v) {} },",
      "});",
      "",
    ].join("\n");
    const store = extractStores(content, "src/stores/app.js")[0]!;
    expect(store.state).toEqual(["count"]);
    expect(store.getters).toEqual(["double"]);
    expect(store.actions).toEqual(["setCount"]);
  });

  it("emits empty arrays (not null) for a Pinia setup store with no return", () => {
    const content = "defineStore('empty', () => { /* nothing returned */ });";
    const store = extractStores(content, "src/stores/empty.js")[0]!;
    expect(store.storeId).toBe("empty");
    expect(store.state).toEqual([]);
    expect(store.getters).toEqual([]);
    expect(store.actions).toEqual([]);
  });

  it("emits an empty state array when an options store has no state", () => {
    const content = "defineStore('minimal', { getters: { foo: () => 1 } });";
    const store = extractStores(content, "src/stores/min.js")[0]!;
    expect(store.state).toEqual([]);
    expect(store.getters).toEqual(["foo"]);
    expect(store.actions).toEqual([]);
  });

  it("returns one contract per defineStore in a multi-store file", () => {
    const content = [
      "defineStore('a', () => { const x = ref(1); return { x }; });",
      "defineStore('b', () => { function y() {} return { y }; });",
      "",
    ].join("\n");
    const stores = extractStores(content, "src/stores/multi.js");
    expect(stores).toHaveLength(2);
    expect(stores[0]!.storeId).toBe("a");
    expect(stores[0]!.state).toEqual(["x"]);
    expect(stores[1]!.storeId).toBe("b");
    expect(stores[1]!.actions).toEqual(["y"]);
  });

  it("returns an empty array for a file with no store definition", () => {
    expect(extractStores("export const value = 42;\n", "src/x.js")).toEqual([]);
  });

  it("prefers export const name when a Vuex store has no string id", () => {
    const content = "export const root = new Vuex.Store({ state: { token: '' } });";
    const store = extractStores(content, "src/stores/root.js")[0]!;
    expect(store.name).toBe("root");
    expect(store.state).toEqual(["token"]);
  });
});
