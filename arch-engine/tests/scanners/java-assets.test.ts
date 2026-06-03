import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findMavenModules } from "../../src/scanners/java.js";
import { discoverJavaCandidates } from "../../src/scanners/java-assets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "..", "fixtures");
const baseCommonRoot = path.join(fixturesRoot, "java", "base-common");

describe("discoverJavaCandidates", () => {
  it("discovers enum, util, pojo, and feign rpc in base-common fixture", async () => {
    const modules = await findMavenModules(baseCommonRoot);
    const baseCommon = modules.find((m) => m.slug === "base-common");
    expect(baseCommon).toBeDefined();

    const candidates = await discoverJavaCandidates(baseCommonRoot, baseCommon!);

    const kinds = new Set(candidates.map((c) => c.kind));
    expect(kinds.has("enum")).toBe(true);
    expect(kinds.has("util")).toBe(true);
    expect(kinds.has("pojo")).toBe(true);
    expect(kinds.has("rpc")).toBe(true);

    expect(candidates.find((c) => c.name === "CommonStatusEnum")).toBeDefined();
    expect(candidates.find((c) => c.name === "JsonUtils")).toBeDefined();
    expect(candidates.find((c) => c.name === "UserResultDTO")).toBeDefined();
    expect(candidates.find((c) => c.name === "DictDataCommonApi")).toBeDefined();

    const jsonUtils = candidates.find((c) => c.name === "JsonUtils");
    expect(jsonUtils?.signatures.length).toBeGreaterThan(0);
  });
});
