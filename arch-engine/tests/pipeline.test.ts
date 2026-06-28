import { describe, expect, it } from "vitest";
import { detectNewUnits } from "../src/pipeline.js";

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
