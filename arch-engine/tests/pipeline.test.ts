import { describe, expect, it } from "vitest";
import { computePathRulesHash, detectNewUnits } from "../src/pipeline.js";
import type { ResolvedJavaPathRules } from "../src/scanners/java-path-rules.js";

describe("detectNewUnits (P1: new-package / new-module incremental detection)", () => {
  it("returns slugs present in the current scan but absent from the previous scan", () => {
    const added = detectNewUnits(["ui", "web", "admin"], ["ui"]);

    expect([...added].sort()).toEqual(["admin", "web"]);
  });

  it("returns an empty set when nothing is new", () => {
    const added = detectNewUnits(["ui", "web"], ["ui", "web"]);

    expect(added.size).toBe(0);
  });

  it("ignores slugs that were removed since the previous scan", () => {
    const added = detectNewUnits(["web"], ["ui", "web", "legacy"]);

    expect([...added]).toEqual([]);
  });

  it("handles empty inputs", () => {
    expect([...detectNewUnits([], [])]).toEqual([]);
    expect([...detectNewUnits(["web"], [])]).toEqual(["web"]);
  });
});

describe("computePathRulesHash", () => {
  const baseRules: ResolvedJavaPathRules = {
    contextPath: "/api",
    controllerPrefixes: [
      {
        prefix: "/admin-api",
        controllerPattern: "**.controller.admin.**",
        source: "manual",
      },
      {
        prefix: "/app-api",
        controllerPattern: "**.controller.app.**",
        source: "auto",
      },
    ],
    confidence: "high",
    sources: [],
  };

  it("returns a stable hex digest for the same rules", () => {
    const a = computePathRulesHash(baseRules);
    const b = computePathRulesHash(baseRules);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is invariant to prefix rule order (sorted by controllerPattern)", () => {
    const reversed: ResolvedJavaPathRules = {
      ...baseRules,
      controllerPrefixes: [...baseRules.controllerPrefixes].reverse(),
    };
    expect(computePathRulesHash(reversed)).toBe(computePathRulesHash(baseRules));
  });

  it("changes when contextPath or prefix values change", () => {
    const changed: ResolvedJavaPathRules = {
      ...baseRules,
      contextPath: "/v2",
    };
    expect(computePathRulesHash(changed)).not.toBe(computePathRulesHash(baseRules));
  });
});
