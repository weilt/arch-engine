import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mapFileToCandidate } from "../../src/discovery/map-file.js";

describe("mapFileToCandidate", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "map-file-"));
    await fs.mkdir(path.join(tmp, "demo", "src"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("maps Java util file", async () => {
    await fs.writeFile(
      path.join(tmp, "demo", "src", "JsonUtils.java"),
      "public class JsonUtils {}",
      "utf-8"
    );
    const c = await mapFileToCandidate(tmp, "demo/src/JsonUtils.java", "demo");
    expect(c).toMatchObject({
      kind: "util",
      name: "JsonUtils",
      moduleSlug: "demo",
      filePath: "demo/src/JsonUtils.java",
    });
  });

  it("returns null for non-asset Java", async () => {
    await fs.writeFile(
      path.join(tmp, "demo", "src", "Plain.java"),
      "interface Plain {}",
      "utf-8"
    );
    const c = await mapFileToCandidate(tmp, "demo/src/Plain.java", "demo");
    expect(c).toBeNull();
  });

  // --- frontend (TS/JS/Vue) content-based classification (v2.0.5) ---
  // The old heuristic rejected any file whose basename did not start with an
  // uppercase letter, so stores/user.ts, utils/format.ts and api/client.ts all
  // returned null and refresh_asset failed. Classification now mirrors how the
  // initial scan (frontend.ts + the frontend scanners) buckets a file.

  it("classifies a Pinia store file (lowercase basename) as store", async () => {
    await fs.mkdir(path.join(tmp, "demo", "stores"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "demo", "stores", "user.ts"),
      [
        "import { defineStore } from 'pinia';",
        "export const useUserStore = defineStore('user', () => {",
        "  const name = ref('');",
        "  return { name };",
        "});",
        "",
      ].join("\n"),
      "utf-8"
    );
    const c = await mapFileToCandidate(tmp, "demo/stores/user.ts", "demo");
    expect(c).not.toBeNull();
    expect(c?.kind).toBe("store");
  });

  it("classifies a plain lowercase util file as util (no longer null)", async () => {
    await fs.mkdir(path.join(tmp, "demo", "utils"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "demo", "utils", "format.ts"),
      [
        "export function formatDate(input: string): string {",
        "  return input;",
        "}",
        "",
      ].join("\n"),
      "utf-8"
    );
    const c = await mapFileToCandidate(tmp, "demo/utils/format.ts", "demo");
    expect(c).not.toBeNull();
    expect(c?.kind).toBe("util");
  });

  it("classifies an axios api-client file (lowercase basename) as api-client", async () => {
    await fs.mkdir(path.join(tmp, "demo", "api"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "demo", "api", "client.ts"),
      [
        "import axios from 'axios';",
        "export const http = axios;",
        "export function listUsers() {",
        "  return axios.get('/users');",
        "}",
        "",
      ].join("\n"),
      "utf-8"
    );
    const c = await mapFileToCandidate(tmp, "demo/api/client.ts", "demo");
    expect(c).not.toBeNull();
    expect(c?.kind).toBe("api-client");
  });

  it("classifies a PascalCase .vue SFC as component", async () => {
    await fs.mkdir(path.join(tmp, "demo", "components"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "demo", "components", "UserCard.vue"),
      [
        "<template><div>{{ msg }}</div></template>",
        "<script setup lang=\"ts\">",
        "const msg = 'hello';",
        "</script>",
        "",
      ].join("\n"),
      "utf-8"
    );
    const c = await mapFileToCandidate(tmp, "demo/components/UserCard.vue", "demo");
    expect(c).not.toBeNull();
    expect(c?.kind).toBe("component");
    expect(c?.name).toBe("UserCard");
  });

  it("classifies a lowercase router file (createRouter) as route", async () => {
    await fs.writeFile(
      path.join(tmp, "demo", "app.ts"),
      [
        "import { createRouter, createWebHistory } from 'vue-router';",
        "const routes = [{ path: '/', component: () => null }];",
        "export const router = createRouter({ history: createWebHistory(), routes });",
        "",
      ].join("\n"),
      "utf-8"
    );
    const c = await mapFileToCandidate(tmp, "demo/app.ts", "demo");
    expect(c).not.toBeNull();
    expect(c?.kind).toBe("route");
  });

  it("classifies a PascalCase component export as component", async () => {
    await fs.writeFile(
      path.join(tmp, "demo", "Header.tsx"),
      [
        "export function Header() {",
        "  return null;",
        "}",
        "",
      ].join("\n"),
      "utf-8"
    );
    const c = await mapFileToCandidate(tmp, "demo/Header.tsx", "demo");
    expect(c).not.toBeNull();
    expect(c?.kind).toBe("component");
  });
});
